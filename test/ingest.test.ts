import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createContributor } from "../src/lib/auth";
import { submitObservationsV2 } from "../src/lib/ingest";
import { D1_QUERY_BUDGET } from "../src/lib/limits";
import { cleanDb } from "./helpers";
import { countQueries } from "./query-budget";
import { makeV2Observation } from "./v2-helpers";
import type { ObservationV2Input } from "../src/db/queries-v2";

beforeEach(cleanDb);

const obs = (overrides: Record<string, unknown> = {}) =>
  makeV2Observation(overrides) as ObservationV2Input;

async function dirtyProducts(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT product_id FROM dirty_products ORDER BY product_id",
  ).all<{ product_id: string }>();
  return results.map((row) => row.product_id);
}

describe("submitObservationsV2", () => {
  it("stores a 50-observation batch in four queries", async () => {
    const { contributorId } = await createContributor(env.DB);
    const batch = Array.from({ length: 50 }, (_, i) =>
      obs({ productId: `woolworths:${1000 + i}` }),
    );
    const counter = countQueries(env.DB);
    const result = await submitObservationsV2(
      counter.db,
      contributorId,
      "history",
      batch,
    );
    expect(result).toEqual({
      accepted: 50,
      duplicates: 0,
      rejected: 0,
      reasons: [],
    });
    expect(counter.count()).toBeLessThanOrEqual(4);
    expect(counter.count()).toBeLessThanOrEqual(D1_QUERY_BUDGET);
  });

  it("counts stored and repeated IDs as duplicates", async () => {
    const { contributorId } = await createContributor(env.DB);
    const first = obs();
    await submitObservationsV2(env.DB, contributorId, "history", [first]);
    const second = obs({ productId: "woolworths:456" });
    const result = await submitObservationsV2(
      env.DB,
      contributorId,
      "history",
      [first, second, second],
    );
    expect(result).toMatchObject({ accepted: 1, duplicates: 2, rejected: 0 });
    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM observations_v2",
    ).first<{ n: number }>();
    expect(stored?.n).toBe(2);
  });

  it("quarantines a price far outside the comparable median", async () => {
    for (let i = 0; i < 5; i++) {
      const { contributorId } = await createContributor(env.DB);
      await submitObservationsV2(env.DB, contributorId, "history", [
        obs({ currentPriceCents: 500 }),
      ]);
    }
    await env.DB.exec("DELETE FROM dirty_products");
    const { contributorId } = await createContributor(env.DB);
    const outlier = obs({ currentPriceCents: 3000 });
    const result = await submitObservationsV2(
      env.DB,
      contributorId,
      "history",
      [outlier],
    );
    expect(result).toEqual({
      accepted: 0,
      duplicates: 0,
      rejected: 1,
      reasons: [`${outlier.clientObservationId}: quarantined`],
    });
    const row = await env.DB.prepare(
      "SELECT quarantined, quarantine_reason FROM observations_v2 WHERE client_observation_id = ?",
    )
      .bind(outlier.clientObservationId)
      .first();
    expect(row).toEqual({
      quarantined: 1,
      quarantine_reason: "price_outside_5x_product_median",
    });
    expect(await dirtyProducts()).toEqual([]);
  });

  it("marks accepted products dirty", async () => {
    const { contributorId } = await createContributor(env.DB);
    await submitObservationsV2(env.DB, contributorId, "history", [
      obs({ productId: "coles:2", storeChain: "coles" }),
      obs({ productId: "coles:1", storeChain: "coles" }),
      obs({ productId: "coles:2", storeChain: "coles" }),
    ]);
    expect(await dirtyProducts()).toEqual(["coles:1", "coles:2"]);
  });

  it("stores every v2 field", async () => {
    const { contributorId } = await createContributor(env.DB);
    const full = obs({
      brand: "Brand",
      category: "Dairy",
      gtin: "9300650000016",
      regularPriceCents: 900,
      unitPriceCents: 150,
      unitMeasure: "1L",
      offerType: "special",
      offerTextNormalized: "2 for $6",
      offerId: "offer-1",
      requiredQuantity: 2,
      sourceSurface: "search_result",
      extractionSource: "dom",
      instrumentMode: "user_activated_inline",
      capturePhase: "pre_ui",
      comparisonId: crypto.randomUUID(),
      storeId: "store-9",
      coarseRegion: "QLD",
      fulfilmentMode: "pickup",
      authState: "signed_in",
      loyaltyState: "member_eligible",
      browserFamily: "Firefox",
    });
    await submitObservationsV2(env.DB, contributorId, "fairness", [full]);
    const row = await env.DB.prepare(
      "SELECT * FROM observations_v2 WHERE client_observation_id = ?",
    )
      .bind(full.clientObservationId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      schema_version: 2,
      contribution_mode: "fairness",
      contributor_id: contributorId,
      product_id: full.productId,
      product_name: full.productName,
      brand: "Brand",
      category: "Dairy",
      gtin: "9300650000016",
      store_chain: full.storeChain,
      current_price_cents: full.currentPriceCents,
      regular_price_cents: 900,
      unit_price_cents: 150,
      unit_measure: "1L",
      offer_type: "special",
      offer_text_normalized: "2 for $6",
      offer_id: "offer-1",
      required_quantity: 2,
      source_surface: "search_result",
      extraction_source: "dom",
      scraper_version: full.scraperVersion,
      instrument_mode: "user_activated_inline",
      capture_phase: "pre_ui",
      comparison_id: full.comparisonId,
      store_id: "store-9",
      coarse_region: "QLD",
      fulfilment_mode: "pickup",
      auth_state: "signed_in",
      loyalty_state: "member_eligible",
      browser_family: "Firefox",
      client_observed_at: full.clientObservedAt,
      quarantined: 0,
      quarantine_reason: null,
    });
  });
});
