import { median } from "./aggregation";
import type { DifferentialSignal, ObserverEffect } from "./types";
import type { ObservationV2Row } from "../db/queries-v2";

const PUBLIC_QUORUM = 5;
const SIGNAL_CONTRIBUTORS = 10;
const PRICE_GROUP_CONTRIBUTORS = 3;

function contextKey(
  row: ObservationV2Row,
  includeAuthAndLoyalty: boolean,
  includePhase = true,
): string {
  const fields = [
    row.store_id ?? "",
    row.coarse_region ?? "",
    row.fulfilment_mode,
    row.offer_type ?? "",
    row.offer_id ?? "",
    row.offer_text_normalized ?? "",
    row.required_quantity ?? "",
    row.source_surface,
    row.instrument_mode,
    includePhase ? row.capture_phase : "",
    row.extraction_source,
    row.scraper_version,
  ];
  if (includeAuthAndLoyalty) {
    fields.push(row.auth_state, row.loyalty_state);
  }
  return JSON.stringify(fields);
}

function groupContributorsByPrice(rows: ObservationV2Row[]) {
  const groups = new Map<number, Set<string>>();
  for (const row of rows) {
    const contributors =
      groups.get(row.current_price_cents) ?? new Set<string>();
    contributors.add(row.contributor_id);
    groups.set(row.current_price_cents, contributors);
  }
  return [...groups.entries()]
    .map(([priceCents, contributors]) => ({
      priceCents,
      contributorCount: contributors.size,
    }))
    .sort((a, b) => a.priceCents - b.priceCents);
}

export function analyseDifferentialPricing(
  rows: ObservationV2Row[],
): DifferentialSignal {
  const fairnessRows = rows.filter(
    (row) =>
      row.contribution_mode === "fairness" &&
      Boolean(row.store_id || row.coarse_region) &&
      row.fulfilment_mode !== "unknown" &&
      row.source_surface !== "unknown" &&
      row.extraction_source !== "unknown" &&
      !["legacy", "unknown", "2.0.0", "2.1.0"].includes(row.scraper_version),
  );
  const byBaseContext = new Map<string, ObservationV2Row[]>();
  for (const row of fairnessRows) {
    const key = contextKey(row, false);
    byBaseContext.set(key, [...(byBaseContext.get(key) ?? []), row]);
  }

  let strongest: DifferentialSignal | null = null;
  for (const contextRows of byBaseContext.values()) {
    const contributors = new Set(contextRows.map((row) => row.contributor_id));
    if (contributors.size < SIGNAL_CONTRIBUTORS) continue;
    const priceGroups = groupContributorsByPrice(contextRows).filter(
      (group) => group.contributorCount >= PRICE_GROUP_CONTRIBUTORS,
    );
    if (priceGroups.length < 2) continue;

    const byDisclosedState = new Map<string, ObservationV2Row[]>();
    for (const row of contextRows) {
      const state = `${row.auth_state}|${row.loyalty_state}`;
      if (state === "unknown|unknown") continue;
      byDisclosedState.set(state, [
        ...(byDisclosedState.get(state) ?? []),
        row,
      ]);
    }
    const eligibleStates = [...byDisclosedState.values()].filter(
      (stateRows) =>
        new Set(stateRows.map((row) => row.contributor_id)).size >=
        PRICE_GROUP_CONTRIBUTORS,
    );
    const stateMedians = new Set(
      eligibleStates.map((stateRows) =>
        median(stateRows.map((row) => row.current_price_cents)),
      ),
    );
    let candidate: DifferentialSignal;
    if (eligibleStates.length >= 2 && stateMedians.size >= 2) {
      candidate = {
        classification: "contextual_difference",
        confidence: "low",
        explanation:
          "Different median prices coincide with disclosed sign-in or loyalty eligibility states. This does not establish causation.",
        matchedContributorCount: contributors.size,
        priceGroups,
      };
    } else {
      const fullyMatched = new Map<string, ObservationV2Row[]>();
      for (const row of contextRows) {
        if (row.auth_state === "unknown" || row.loyalty_state === "unknown")
          continue;
        const key = contextKey(row, true);
        fullyMatched.set(key, [...(fullyMatched.get(key) ?? []), row]);
      }
      candidate = {
        classification: "insufficient_evidence",
        confidence: "none",
        explanation:
          "A price difference was observed, but no fully matched cohort met the persistence threshold.",
        matchedContributorCount: contributors.size,
        priceGroups,
      };
      for (const matchedRows of fullyMatched.values()) {
        const matchedContributors = new Set(
          matchedRows.map((row) => row.contributor_id),
        );
        if (matchedContributors.size < SIGNAL_CONTRIBUTORS) continue;
        const matchedPriceGroups = groupContributorsByPrice(matchedRows).filter(
          (group) => group.contributorCount >= PRICE_GROUP_CONTRIBUTORS,
        );
        if (matchedPriceGroups.length < 2) continue;
        const byHour = new Map<string, ObservationV2Row[]>();
        for (const row of matchedRows) {
          const hour = row.client_observed_at.slice(0, 13);
          byHour.set(hour, [...(byHour.get(hour) ?? []), row]);
        }
        const patterns = new Map<string, number>();
        for (const bucket of byHour.values()) {
          // One contributor cannot populate multiple price groups in a window.
          const latestByContributor = new Map<string, ObservationV2Row>();
          for (const row of bucket) {
            const previous = latestByContributor.get(row.contributor_id);
            if (
              !previous ||
              previous.client_observed_at < row.client_observed_at
            )
              latestByContributor.set(row.contributor_id, row);
          }
          if (latestByContributor.size < SIGNAL_CONTRIBUTORS) continue;
          const groups = groupContributorsByPrice([
            ...latestByContributor.values(),
          ]).filter(
            (group) => group.contributorCount >= PRICE_GROUP_CONTRIBUTORS,
          );
          if (groups.length < 2) continue;
          const pattern = JSON.stringify(
            groups.map((group) => group.priceCents),
          );
          patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
        }
        if ([...patterns.values()].some((count) => count >= 2)) {
          candidate = {
            classification: "possible_differential_pricing",
            confidence: "moderate",
            explanation:
              "Multiple price groups persisted in at least two time buckets after matching known context. This is evidence for review, not proof of personalisation.",
            matchedContributorCount: matchedContributors.size,
            priceGroups: matchedPriceGroups,
          };
          break;
        }
      }
    }
    if (
      !strongest ||
      candidate.matchedContributorCount > strongest.matchedContributorCount
    ) {
      strongest = candidate;
    }
  }

  return (
    strongest ?? {
      classification: "insufficient_evidence",
      confidence: "none",
      explanation:
        "No matched cohort met the minimum of 10 contributors and 3 contributors per price group.",
      matchedContributorCount: 0,
      priceGroups: [],
    }
  );
}

export function analyseObserverEffect(
  rows: ObservationV2Row[],
): ObserverEffect {
  const pairs = new Map<
    string,
    {
      contributor: string;
      pre?: ObservationV2Row;
      post?: ObservationV2Row;
      ambiguous?: boolean;
    }
  >();
  for (const row of rows) {
    if (
      !row.comparison_id ||
      row.contribution_mode !== "fairness" ||
      row.instrument_mode !== "user_activated_inline" ||
      ["legacy", "unknown", "2.0.0", "2.1.0"].includes(row.scraper_version) ||
      row.extraction_source === "unknown" ||
      row.source_surface === "unknown"
    )
      continue;
    const key = `${row.contributor_id}:${row.comparison_id}`;
    const pair = pairs.get(key) ?? { contributor: row.contributor_id };
    if (row.capture_phase === "pre_ui") {
      if (pair.pre) pair.ambiguous = true;
      pair.pre = row;
    }
    if (row.capture_phase === "post_ui") {
      if (pair.post) pair.ambiguous = true;
      pair.post = row;
    }
    pairs.set(key, pair);
  }
  const complete = [...pairs.values()].flatMap((pair) => {
    if (
      pair.ambiguous ||
      !pair.pre ||
      !pair.post ||
      pair.pre.product_id !== pair.post.product_id ||
      contextKey(pair.pre, true, false) !== contextKey(pair.post, true, false)
    )
      return [];
    const elapsed =
      Date.parse(pair.post.client_observed_at) -
      Date.parse(pair.pre.client_observed_at);
    // The extension samples at one second. Allow timer jitter, but never match
    // a stale price from another browsing session into the same comparison.
    if (elapsed < 0 || elapsed > 10_000) return [];
    return [
      {
        contributor: pair.contributor,
        pre: pair.pre.current_price_cents,
        post: pair.post.current_price_cents,
      },
    ];
  });
  const contributors = new Set(complete.map((pair) => pair.contributor));
  if (contributors.size < PUBLIC_QUORUM) {
    return {
      comparisonCount: 0,
      contributorCount: contributors.size,
      changedCount: 0,
      medianChangeCents: null,
    };
  }
  const changes = complete.map((pair) => pair.post - pair.pre);
  return {
    comparisonCount: complete.length,
    contributorCount: contributors.size,
    changedCount: changes.filter((change) => change !== 0).length,
    medianChangeCents: median(changes),
  };
}
