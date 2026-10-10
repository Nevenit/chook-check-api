/** Queue products for a public stats refresh; a newer mark replaces an older one. */
export async function markProductsDirty(
  db: D1Database,
  productIds: string[],
  now: Date,
): Promise<void> {
  if (productIds.length === 0) return;
  await db
    .prepare(
      `INSERT INTO dirty_products (product_id, marked_at)
       SELECT value, ?2 FROM json_each(?1) WHERE true
       ON CONFLICT (product_id) DO UPDATE SET marked_at = excluded.marked_at`,
    )
    .bind(JSON.stringify([...new Set(productIds)]), now.toISOString())
    .run();
}
