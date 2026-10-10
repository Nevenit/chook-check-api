import type { ObservationV2Input } from "../db/queries-v2";
import { markProductsDirty } from "../db/dirty-products";

export interface SubmitResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  reasons: string[];
}

const QUARANTINE_REASON = "price_outside_5x_product_median";

const groupKey = (productId: string, day: string, offer: string) =>
  `${productId}|${day}|${offer}`;

/** Up to 51 latest comparable prices per product/day/offer, from stored rows. */
async function referencePrices(
  db: D1Database,
  observations: ObservationV2Input[],
): Promise<Map<string, number[]>> {
  const wanted = observations.map((o) => [
    o.productId,
    o.clientObservedAt.slice(0, 10),
    o.offerType ?? "",
  ]);
  const { results } = await db
    .prepare(
      `WITH wanted AS (
         SELECT DISTINCT json_extract(value, '$[0]') AS product_id,
                         json_extract(value, '$[1]') AS day,
                         json_extract(value, '$[2]') AS offer
         FROM json_each(?1)
       ),
       ranked AS (
         SELECT w.product_id, w.day, w.offer, o.current_price_cents,
                ROW_NUMBER() OVER (
                  PARTITION BY w.product_id, w.day, w.offer
                  ORDER BY o.client_observed_at DESC
                ) AS rn
         FROM wanted w
         JOIN observations_v2 o
           ON o.product_id = w.product_id
          AND o.client_observed_at >= w.day
          AND o.client_observed_at < date(w.day, '+1 day')
          AND COALESCE(o.offer_type, '') = w.offer
          AND o.quarantined = 0
       )
       SELECT product_id, day, offer, current_price_cents
       FROM ranked WHERE rn <= 51`,
    )
    .bind(JSON.stringify(wanted))
    .all<{
      product_id: string;
      day: string;
      offer: string;
      current_price_cents: number;
    }>();
  const prices = new Map<string, number[]>();
  for (const row of results) {
    const key = groupKey(row.product_id, row.day, row.offer);
    prices.set(key, [...(prices.get(key) ?? []), row.current_price_cents]);
  }
  return prices;
}

function quarantineReason(
  observation: ObservationV2Input,
  reference: Map<string, number[]>,
): string | null {
  const prices = [
    ...(reference.get(
      groupKey(
        observation.productId,
        observation.clientObservedAt.slice(0, 10),
        observation.offerType ?? "",
      ),
    ) ?? []),
  ].sort((a, b) => a - b);
  if (prices.length < 5) return null;
  const median = prices[Math.floor(prices.length / 2)];
  return observation.currentPriceCents < median * 0.2 ||
    observation.currentPriceCents > median * 5
    ? QUARANTINE_REASON
    : null;
}

/**
 * Store a validated batch in four D1 queries regardless of its size.
 * Quarantine compares against rows stored before this batch.
 */
export async function submitObservationsV2(
  db: D1Database,
  contributorId: string,
  mode: "history" | "fairness",
  observations: ObservationV2Input[],
  now = new Date(),
): Promise<SubmitResult> {
  const { results: existing } = await db
    .prepare(
      `SELECT client_observation_id FROM observations_v2
       WHERE contributor_id = ?1
         AND client_observation_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(
      contributorId,
      JSON.stringify(observations.map((o) => o.clientObservationId)),
    )
    .all<{ client_observation_id: string }>();
  const seen = new Set(existing.map((row) => row.client_observation_id));
  const fresh: ObservationV2Input[] = [];
  for (const observation of observations) {
    if (seen.has(observation.clientObservationId)) continue;
    seen.add(observation.clientObservationId);
    fresh.push(observation);
  }
  const duplicates = observations.length - fresh.length;
  if (fresh.length === 0) {
    return { accepted: 0, duplicates, rejected: 0, reasons: [] };
  }

  const reference = await referencePrices(db, fresh);
  const rows = fresh.map((observation) => ({
    ...observation,
    quarantineReason: quarantineReason(observation, reference),
  }));
  await db
    .prepare(
      `INSERT INTO observations_v2 (
         schema_version, client_observation_id, contribution_mode, contributor_id,
         product_id, product_name, brand, category, gtin, store_chain,
         current_price_cents, regular_price_cents, unit_price_cents, unit_measure,
         offer_type, offer_text_normalized, offer_id, required_quantity,
         source_surface, extraction_source, scraper_version, instrument_mode,
         capture_phase, comparison_id, store_id, coarse_region, fulfilment_mode,
         auth_state, loyalty_state, browser_family, client_observed_at, submitted_at,
         quarantined, quarantine_reason
       )
       SELECT 2, json_extract(value, '$.clientObservationId'), ?2, ?1,
              json_extract(value, '$.productId'), json_extract(value, '$.productName'),
              json_extract(value, '$.brand'), json_extract(value, '$.category'),
              json_extract(value, '$.gtin'), json_extract(value, '$.storeChain'),
              json_extract(value, '$.currentPriceCents'),
              json_extract(value, '$.regularPriceCents'),
              json_extract(value, '$.unitPriceCents'),
              json_extract(value, '$.unitMeasure'),
              json_extract(value, '$.offerType'),
              json_extract(value, '$.offerTextNormalized'),
              json_extract(value, '$.offerId'),
              json_extract(value, '$.requiredQuantity'),
              json_extract(value, '$.sourceSurface'),
              json_extract(value, '$.extractionSource'),
              json_extract(value, '$.scraperVersion'),
              json_extract(value, '$.instrumentMode'),
              json_extract(value, '$.capturePhase'),
              json_extract(value, '$.comparisonId'),
              json_extract(value, '$.storeId'), json_extract(value, '$.coarseRegion'),
              json_extract(value, '$.fulfilmentMode'), json_extract(value, '$.authState'),
              json_extract(value, '$.loyaltyState'), json_extract(value, '$.browserFamily'),
              json_extract(value, '$.clientObservedAt'), ?3,
              json_extract(value, '$.quarantineReason') IS NOT NULL,
              json_extract(value, '$.quarantineReason')
       FROM json_each(?4) WHERE true
       ON CONFLICT (contributor_id, client_observation_id) DO NOTHING`,
    )
    .bind(contributorId, mode, now.toISOString(), JSON.stringify(rows))
    .run();

  const accepted = rows.filter((row) => !row.quarantineReason);
  await markProductsDirty(
    db,
    accepted.map((row) => row.productId),
    now,
  );
  const rejected = rows.filter((row) => row.quarantineReason);
  return {
    accepted: accepted.length,
    duplicates,
    rejected: rejected.length,
    reasons: rejected.map((row) => `${row.clientObservationId}: quarantined`),
  };
}
