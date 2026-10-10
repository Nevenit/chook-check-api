export const STATS_BATCH_SIZE = 100;
// Once a day keeps a full refresh pass within Workers Free's 5M rows read/day.
export const DIRTY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STALE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RAW_WINDOW_DAYS = 180;
const CURRENT_WINDOW_DAYS = 90;
const PUBLIC_QUORUM = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The only fields published per product; the extension displays them all. */
export interface SnapshotProduct {
  productId: string;
  productName: string;
  brand: string | null;
  storeChain: string;
  quorum: true;
  currentMedianCents: number;
  minCents: number;
  maxCents: number;
  observationCount: number;
  contributorCount: number;
  promoFrequency: Record<string, number>;
}

const ago = (now: Date, ms: number) =>
  new Date(now.getTime() - ms).toISOString();

async function selectProducts(db: D1Database, now: Date): Promise<string[]> {
  const { results: dirty } = await db
    .prepare(
      `SELECT d.product_id FROM dirty_products d
       LEFT JOIN product_stats s ON s.product_id = d.product_id
       WHERE s.refreshed_at IS NULL OR s.refreshed_at <= ?1
       ORDER BY d.marked_at LIMIT ?2`,
    )
    .bind(ago(now, DIRTY_REFRESH_INTERVAL_MS), STATS_BATCH_SIZE)
    .all<{ product_id: string }>();
  const ids = new Set(dirty.map((row) => row.product_id));
  if (ids.size < STATS_BATCH_SIZE) {
    // Windows slide even without new data, so public stats are recomputed daily.
    // A non-public product can only become public through new (dirty) data.
    const { results: stale } = await db
      .prepare(
        `SELECT product_id FROM product_stats
         WHERE public = 1 AND refreshed_at <= ?1 ORDER BY refreshed_at LIMIT ?2`,
      )
      .bind(ago(now, STALE_REFRESH_INTERVAL_MS), STATS_BATCH_SIZE - ids.size)
      .all<{ product_id: string }>();
    for (const row of stale) ids.add(row.product_id);
  }
  return [...ids];
}

/** Recompute public stats for up to one batch of products in seven queries. */
export async function refreshProductStats(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const productIds = await selectProducts(db, now);
  if (productIds.length === 0) return 0;
  const ids = JSON.stringify(productIds);
  const rawSince = ago(now, RAW_WINDOW_DAYS * DAY_MS);
  const currentSince = ago(now, CURRENT_WINDOW_DAYS * DAY_MS);

  // SQLite takes bare columns from the row holding MAX(client_observed_at).
  const summary = db
    .prepare(
      `SELECT product_id, COUNT(*) AS observation_count,
              COUNT(DISTINCT contributor_id) AS contributor_count,
              MAX(client_observed_at) AS latest_at,
              product_name, brand, store_chain
       FROM observations_v2
       WHERE product_id IN (SELECT value FROM json_each(?1))
         AND client_observed_at >= ?2 AND quarantined = 0
       GROUP BY product_id`,
    )
    .bind(ids, rawSince)
    .all<{
      product_id: string;
      observation_count: number;
      contributor_count: number;
      product_name: string;
      brand: string | null;
      store_chain: string;
    }>();
  const current = db
    .prepare(
      `WITH balanced AS (
         SELECT product_id, substr(client_observed_at, 1, 10) AS day,
                current_price_cents,
                ROW_NUMBER() OVER (
                  PARTITION BY product_id, contributor_id, substr(client_observed_at, 1, 10)
                  ORDER BY client_observed_at DESC
                ) AS rn
         FROM observations_v2
         WHERE product_id IN (SELECT value FROM json_each(?1))
           AND client_observed_at >= ?2 AND quarantined = 0
       ),
       latest AS (SELECT product_id, day, current_price_cents FROM balanced WHERE rn = 1),
       qualifying AS (
         SELECT product_id, MAX(day) AS day FROM (
           SELECT product_id, day FROM latest
           GROUP BY product_id, day HAVING COUNT(*) >= ?3
         ) GROUP BY product_id
       ),
       ranked AS (
         SELECT l.product_id, l.current_price_cents,
                ROW_NUMBER() OVER (PARTITION BY l.product_id ORDER BY l.current_price_cents) AS pos,
                COUNT(*) OVER (PARTITION BY l.product_id) AS n
         FROM latest l
         JOIN qualifying q ON q.product_id = l.product_id AND q.day = l.day
       )
       SELECT product_id,
              AVG(CASE WHEN pos IN ((n + 1) / 2, (n + 2) / 2) THEN current_price_cents END) AS median_cents,
              MIN(current_price_cents) AS min_cents,
              MAX(current_price_cents) AS max_cents
       FROM ranked GROUP BY product_id`,
    )
    .bind(ids, currentSince, PUBLIC_QUORUM)
    .all<{
      product_id: string;
      median_cents: number;
      min_cents: number;
      max_cents: number;
    }>();
  const promos = db
    .prepare(
      `WITH balanced AS (
         SELECT product_id, offer_type,
                ROW_NUMBER() OVER (
                  PARTITION BY product_id, contributor_id, substr(client_observed_at, 1, 10)
                  ORDER BY client_observed_at DESC
                ) AS rn
         FROM observations_v2
         WHERE product_id IN (SELECT value FROM json_each(?1))
           AND client_observed_at >= ?2 AND quarantined = 0
       )
       SELECT product_id, COALESCE(offer_type, 'none') AS offer, COUNT(*) AS n
       FROM balanced WHERE rn = 1 GROUP BY product_id, offer`,
    )
    .bind(ids, rawSince)
    .all<{ product_id: string; offer: string; n: number }>();
  const [summaryRows, currentRows, promoRows] = await Promise.all([
    summary,
    current,
    promos,
  ]);

  const currentById = new Map(
    currentRows.results.map((row) => [row.product_id, row]),
  );
  const promoCounts = new Map<string, Record<string, number>>();
  for (const row of promoRows.results) {
    promoCounts.set(row.product_id, {
      ...promoCounts.get(row.product_id),
      [row.offer]: row.n,
    });
  }
  const entries = productIds.map((productId) => {
    const s = summaryRows.results.find((row) => row.product_id === productId);
    const c = currentById.get(productId);
    if (!s || !c) return { productId, public: 0, statsJson: null };
    const counts = promoCounts.get(productId) ?? {};
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const product: SnapshotProduct = {
      productId,
      productName: s.product_name,
      brand: s.brand,
      storeChain: s.store_chain,
      quorum: true,
      currentMedianCents: c.median_cents,
      minCents: c.min_cents,
      maxCents: c.max_cents,
      observationCount: s.observation_count,
      contributorCount: s.contributor_count,
      promoFrequency: Object.fromEntries(
        Object.entries(counts).map(([offer, n]) => [offer, n / total]),
      ),
    };
    return { productId, public: 1, statsJson: JSON.stringify(product) };
  });

  await db
    .prepare(
      `INSERT INTO product_stats (product_id, public, stats_json, refreshed_at)
       SELECT json_extract(value, '$.productId'), json_extract(value, '$.public'),
              json_extract(value, '$.statsJson'), ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (product_id) DO UPDATE SET
         public = excluded.public,
         stats_json = excluded.stats_json,
         refreshed_at = excluded.refreshed_at`,
    )
    .bind(JSON.stringify(entries), now.toISOString())
    .run();
  // Marks made after this run started stay queued for the next refresh.
  await db
    .prepare(
      `DELETE FROM dirty_products
       WHERE product_id IN (SELECT value FROM json_each(?1)) AND marked_at <= ?2`,
    )
    .bind(ids, now.toISOString())
    .run();
  return productIds.length;
}
