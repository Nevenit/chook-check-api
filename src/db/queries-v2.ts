import type { z } from "zod";
import { markProductsDirty } from "./dirty-products";
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
  offer_text_normalized: string | null;
  extraction_source: string;
  scraper_version: string;
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

export async function deleteContributorV2(
  db: D1Database,
  contributorId: string,
): Promise<number> {
  // Delete before marking, so a refresh cannot read rows that are about to go
  // and then clear the mark. Deletions are due immediately, not throttled.
  const { results } = await db
    .prepare(
      `DELETE FROM observations_v2 WHERE contributor_id = ? RETURNING product_id`,
    )
    .bind(contributorId)
    .all<{ product_id: string }>();
  await markProductsDirty(
    db,
    results.map((row) => row.product_id),
    new Date(),
    { immediate: true },
  );
  await db
    .prepare(
      `UPDATE contributors SET status = 'deleted', deleted_at = ? WHERE id = ?`,
    )
    .bind(new Date().toISOString(), contributorId)
    .run();
  return results.length;
}
