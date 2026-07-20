import type { z } from "zod";
import type { observationV2Schema } from "../lib/schemas";

export type ObservationV2Input = z.infer<typeof observationV2Schema>;

export interface ObservationV2Row {
  contributor_id: string;
  product_id: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
  current_price_cents: number;
  regular_price_cents: number | null;
  offer_type: string | null;
  offer_id: string | null;
  required_quantity: number | null;
  source_surface: string;
  instrument_mode: string;
  capture_phase: string;
  comparison_id: string | null;
  store_id: string | null;
  coarse_region: string | null;
  fulfilment_mode: string;
  auth_state: string;
  loyalty_state: string;
  client_observed_at: string;
  contribution_mode: string;
}

export interface DailyProductAggregateRow {
  product_id: string;
  observation_date: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
  median_price_cents: number;
  min_price_cents: number;
  max_price_cents: number;
  observation_count: number;
  contributor_count: number;
}

export async function isDuplicateV2(
  db: D1Database,
  contributorId: string,
  clientObservationId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM observations_v2
       WHERE contributor_id = ? AND client_observation_id = ? LIMIT 1`,
    )
    .bind(contributorId, clientObservationId)
    .first();
  return row !== null;
}

export async function shouldQuarantineV2(
  db: D1Database,
  observation: ObservationV2Input,
): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT current_price_cents FROM observations_v2
       WHERE product_id = ? AND quarantined = 0
         AND substr(client_observed_at, 1, 10) = ?
         AND COALESCE(offer_type, '') = COALESCE(?, '')
       ORDER BY client_observed_at DESC LIMIT 51`,
    )
    .bind(
      observation.productId,
      observation.clientObservedAt.slice(0, 10),
      observation.offerType,
    )
    .all<{ current_price_cents: number }>();
  const prices = (results ?? [])
    .map((row) => row.current_price_cents)
    .sort((a, b) => a - b);
  if (prices.length < 5) return null;
  const median = prices[Math.floor(prices.length / 2)];
  if (
    observation.currentPriceCents < median * 0.2 ||
    observation.currentPriceCents > median * 5
  ) {
    return "price_outside_5x_product_median";
  }
  return null;
}

export async function insertObservationV2(
  db: D1Database,
  contributorId: string,
  mode: "history" | "fairness",
  observation: ObservationV2Input,
  quarantineReason: string | null,
): Promise<void> {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      2,
      observation.clientObservationId,
      mode,
      contributorId,
      observation.productId,
      observation.productName,
      observation.brand,
      observation.category,
      observation.gtin,
      observation.storeChain,
      observation.currentPriceCents,
      observation.regularPriceCents,
      observation.unitPriceCents,
      observation.unitMeasure,
      observation.offerType,
      observation.offerTextNormalized,
      observation.offerId,
      observation.requiredQuantity,
      observation.sourceSurface,
      observation.extractionSource,
      observation.scraperVersion,
      observation.instrumentMode,
      observation.capturePhase,
      observation.comparisonId,
      observation.storeId,
      observation.coarseRegion,
      observation.fulfilmentMode,
      observation.authState,
      observation.loyaltyState,
      observation.browserFamily,
      observation.clientObservedAt,
      new Date().toISOString(),
      quarantineReason ? 1 : 0,
      quarantineReason,
    )
    .run();
}

export async function getProductRowsV2(
  db: D1Database,
  productId: string,
  days = 180,
): Promise<ObservationV2Row[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT contributor_id, product_id, product_name, brand, store_chain,
              current_price_cents, regular_price_cents, offer_type, offer_id,
              required_quantity, source_surface, instrument_mode, capture_phase,
              comparison_id, store_id, coarse_region, fulfilment_mode, auth_state,
              loyalty_state, client_observed_at, contribution_mode
       FROM observations_v2
       WHERE product_id = ? AND client_observed_at >= ? AND quarantined = 0
       ORDER BY client_observed_at ASC`,
    )
    .bind(productId, since)
    .all<ObservationV2Row>();
  return results ?? [];
}

export async function getDailyProductAggregates(
  db: D1Database,
  productId: string,
): Promise<DailyProductAggregateRow[]> {
  const since = new Date(
    Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { results } = await db
    .prepare(
      `SELECT product_id, observation_date, product_name, brand, store_chain,
              median_price_cents, min_price_cents, max_price_cents,
              observation_count, contributor_count
       FROM daily_product_aggregates
       WHERE product_id = ? AND observation_date >= substr(?, 1, 10)
       ORDER BY observation_date ASC`,
    )
    .bind(productId, since)
    .all<DailyProductAggregateRow>();
  return results ?? [];
}

export async function listPublicProductIdsV2(
  db: D1Database,
): Promise<string[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT product_id FROM observations_v2
       WHERE client_observed_at >= ? AND quarantined = 0
       GROUP BY product_id
       HAVING COUNT(DISTINCT contributor_id) >= 5
       ORDER BY product_id`,
    )
    .bind(since)
    .all<{ product_id: string }>();
  return (results ?? []).map((row) => row.product_id);
}

export async function deleteContributorV2(
  db: D1Database,
  contributorId: string,
): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM observations_v2 WHERE contributor_id = ?`)
    .bind(contributorId)
    .run();
  await db
    .prepare(
      `UPDATE contributors SET status = 'deleted', deleted_at = ? WHERE id = ?`,
    )
    .bind(new Date().toISOString(), contributorId)
    .run();
  return result.meta?.changes ?? 0;
}
