/** A changed product's public stats are recomputed at most this often. */
export const DIRTY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Queue products for a public stats refresh. A mark is due once the refresh
 * throttle allows it; `immediate` marks (e.g. after a contributor deletes
 * their data) are due now. Re-marking never delays an earlier due time.
 */
export async function markProductsDirty(
  db: D1Database,
  productIds: string[],
  now: Date,
  { immediate = false }: { immediate?: boolean } = {},
): Promise<void> {
  if (productIds.length === 0) return;
  await db
    .prepare(
      `INSERT INTO dirty_products (product_id, marked_at, due_at)
       SELECT j.value, ?2,
              CASE WHEN ?3 = 1 OR s.refreshed_at IS NULL THEN ?2
                   ELSE MAX(?2, strftime('%Y-%m-%dT%H:%M:%fZ', s.refreshed_at, ?4))
              END
       FROM json_each(?1) j
       LEFT JOIN product_stats s ON s.product_id = j.value
       WHERE true
       ON CONFLICT (product_id) DO UPDATE SET
         marked_at = excluded.marked_at,
         due_at = MIN(due_at, excluded.due_at)`,
    )
    .bind(
      JSON.stringify([...new Set(productIds)]),
      now.toISOString(),
      immediate ? 1 : 0,
      `+${DIRTY_REFRESH_INTERVAL_MS / 1000} seconds`,
    )
    .run();
}
