import { describe, expect, it } from "vitest";
import {
  analyseDifferentialPricing,
  analyseObserverEffect,
} from "../src/lib/aggregation-v2";
import type { ObservationV2Row } from "../src/db/queries-v2";

function row(overrides: Partial<ObservationV2Row> = {}): ObservationV2Row {
  return {
    contributor_id: "contributor-0",
    product_id: "coles:123",
    product_name: "Milk",
    brand: null,
    store_chain: "coles",
    current_price_cents: 500,
    regular_price_cents: null,
    offer_type: null,
    offer_id: null,
    offer_text_normalized: null,
    required_quantity: null,
    source_surface: "product_page",
    extraction_source: "dom",
    scraper_version: "2.2.0",
    instrument_mode: "silent",
    capture_phase: "baseline",
    comparison_id: null,
    store_id: "store-1",
    coarse_region: null,
    fulfilment_mode: "pickup",
    auth_state: "guest",
    loyalty_state: "non_member",
    client_observed_at: "2026-09-06T01:00:00.000Z",
    contribution_mode: "fairness",
    ...overrides,
  };
}

function cohort(overrides: Partial<ObservationV2Row> = {}) {
  return [1, 2].flatMap((hour) =>
    Array.from({ length: 10 }, (_, index) =>
      row({
        contributor_id: `contributor-${index}`,
        current_price_cents: index < 5 ? 500 : 600,
        client_observed_at: `2026-09-06T0${hour}:00:00.000Z`,
        ...overrides,
      }),
    ),
  );
}

describe("matched pricing evidence", () => {
  it("recognizes the same price groups in two fully matched hourly cohorts", () => {
    expect(analyseDifferentialPricing(cohort()).classification).toBe(
      "possible_differential_pricing",
    );
  });

  it.each([
    { auth_state: "unknown" },
    { loyalty_state: "unknown" },
    { fulfilment_mode: "unknown" },
    { source_surface: "unknown" },
    { scraper_version: "legacy" },
    { scraper_version: "2.1.0" },
    { extraction_source: "unknown" },
  ])("does not promote incomplete evidence: %j", (context) => {
    expect(analyseDifferentialPricing(cohort(context)).classification).toBe(
      "insufficient_evidence",
    );
  });

  it("requires the same price pattern to recur", () => {
    const rows = cohort().map((sample) =>
      sample.client_observed_at.includes("T02")
        ? { ...sample, current_price_cents: sample.current_price_cents + 100 }
        : sample,
    );
    expect(analyseDifferentialPricing(rows).classification).toBe(
      "insufficient_evidence",
    );
  });

  it("does not count one contributor in both price groups within an hour", () => {
    const rows = cohort({ current_price_cents: 500 }).flatMap((sample) => [
      sample,
      {
        ...sample,
        current_price_cents: 600,
        client_observed_at: sample.client_observed_at.replace(
          ":00:00.",
          ":00:01.",
        ),
      },
    ]);
    expect(analyseDifferentialPricing(rows).classification).toBe(
      "insufficient_evidence",
    );
  });

  it("requires ten contributors in each qualifying window", () => {
    const rows = cohort().filter((sample, index) => index < 6 || index >= 14);
    expect(analyseDifferentialPricing(rows).classification).toBe(
      "insufficient_evidence",
    );
  });
});

function pairs(postOverrides: Partial<ObservationV2Row> = {}) {
  return Array.from({ length: 5 }, (_, index) => {
    const common = {
      contributor_id: `contributor-${index}`,
      comparison_id: `pair-${index}`,
      instrument_mode: "user_activated_inline",
    };
    return [
      row({ ...common, capture_phase: "pre_ui" }),
      row({
        ...common,
        capture_phase: "post_ui",
        client_observed_at: "2026-09-06T01:00:01.000Z",
        ...postOverrides,
      }),
    ];
  }).flat();
}

describe("observer-effect pairs", () => {
  it("includes unchanged pairs in the denominator", () => {
    const rows = pairs();
    rows[1].current_price_cents = 550;
    expect(analyseObserverEffect(rows)).toEqual({
      contributorCount: 5,
      comparisonCount: 5,
      changedCount: 1,
      medianChangeCents: 0,
    });
  });

  it.each([
    { store_id: "another-store" },
    { offer_text_normalized: "members only" },
    { auth_state: "signed_in" },
    { client_observed_at: "2026-09-06T02:00:00.000Z" },
    { client_observed_at: "2026-09-06T00:59:59.000Z" },
    { product_id: "coles:456" },
    { scraper_version: "legacy" },
  ])("excludes mismatched or stale pairs: %j", (context) => {
    expect(analyseObserverEffect(pairs(context)).comparisonCount).toBe(0);
  });

  it("does not select a price from ambiguous repeated post captures", () => {
    const rows = pairs();
    rows.push({ ...rows[1], current_price_cents: 700 });
    expect(analyseObserverEffect(rows).comparisonCount).toBe(0);
  });

  it("withholds results when fewer than five contributors have complete pairs", () => {
    expect(analyseObserverEffect(pairs().slice(0, -1))).toMatchObject({
      contributorCount: 4,
      comparisonCount: 0,
      medianChangeCents: null,
    });
  });
});
