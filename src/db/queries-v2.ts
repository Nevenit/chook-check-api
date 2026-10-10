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
  await db
    .prepare(
      `INSERT INTO dirty_products (product_id, marked_at)
         SELECT DISTINCT product_id, ?2 FROM observations_v2 WHERE contributor_id = ?1
         ON CONFLICT (product_id) DO UPDATE SET marked_at = excluded.marked_at`,
    )
    .bind(contributorId, new Date().toISOString())
    .run();
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
