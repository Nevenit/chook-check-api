const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_SIX_HOURS_MS = 26 * 60 * 60 * 1000;

/**
 * Delete rate_limits rows whose window has expired (older than 2 hours).
 * The active rate-limit window is 1 hour, so 2 hours guarantees rows are
 * unused before deletion. Triggered hourly by the cron handler.
 */
export async function cleanupRateLimits(db: D1Database): Promise<number> {
  const shortCutoff = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  const registrationCutoff = new Date(
    Date.now() - TWENTY_SIX_HOURS_MS,
  ).toISOString();
  const result = await db
    .prepare(
      `DELETE FROM rate_limits
       WHERE (endpoint LIKE '%contributors%' AND window_start < ?)
          OR (endpoint NOT LIKE '%contributors%' AND window_start < ?)`,
    )
    .bind(registrationCutoff, shortCutoff)
    .run();
  return result.meta?.changes ?? 0;
}

const RAW_RETENTION_DAYS = 180;
const AGGREGATE_RETENTION_DAYS = 3 * 365;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_CHUNK_SIZE = 1000;
export const RETENTION_MAX_CHUNKS = 5;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Expire raw observations one UTC day at a time. Days with at least five
 * contributors are aggregated once before any of their rows are deleted.
 */
export async function runRetentionStep(
  db: D1Database,
  now = new Date(),
  {
    chunkSize = RETENTION_CHUNK_SIZE,
    maxChunks = RETENTION_MAX_CHUNKS,
  }: { chunkSize?: number; maxChunks?: number } = {},
): Promise<number> {
  const rawCutoff = isoDate(now.getTime() - RAW_RETENTION_DAYS * DAY_MS);
  const aggregateCutoff = isoDate(
    now.getTime() - AGGREGATE_RETENTION_DAYS * DAY_MS,
  );
  await db
    .prepare(`DELETE FROM daily_product_aggregates WHERE observation_date < ?1`)
    .bind(aggregateCutoff)
    .run();

  const oldest = await db
    .prepare(`SELECT MIN(client_observed_at) AS oldest FROM observations_v2`)
    .first<{ oldest: string | null }>();
  const day = oldest?.oldest?.slice(0, 10);
  // Progress for days with no rows left (e.g. the last chunk was exactly full).
  await db
    .prepare(`DELETE FROM retention_progress WHERE observation_date < ?1`)
    .bind(day ?? rawCutoff)
    .run();
  if (!day || day >= rawCutoff) return 0;
  const nextDay = isoDate(Date.parse(`${day}T00:00:00Z`) + DAY_MS);

  const progress = await db
    .prepare(
      `SELECT 1 AS done FROM retention_progress WHERE observation_date = ?1`,
    )
    .bind(day)
    .first();
  if (!progress) {
    if (day >= aggregateCutoff) {
      await db
        .prepare(
          `WITH latest AS (
             SELECT product_id, product_name, brand, store_chain,
                    current_price_cents, client_observed_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY product_id, contributor_id
                      ORDER BY client_observed_at DESC
                    ) AS rn
             FROM observations_v2
             WHERE client_observed_at >= ?1 AND client_observed_at < ?2
               AND quarantined = 0
           ),
           ranked AS (
             SELECT *,
                    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY current_price_cents) AS pos,
                    COUNT(*) OVER (PARTITION BY product_id) AS n,
                    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY client_observed_at DESC) AS recency
             FROM latest WHERE rn = 1
           )
           INSERT INTO daily_product_aggregates (
             product_id, observation_date, product_name, brand, store_chain,
             median_price_cents, min_price_cents, max_price_cents,
             observation_count, contributor_count, created_at
           )
           SELECT product_id, ?1,
                  MAX(CASE WHEN recency = 1 THEN product_name END),
                  MAX(CASE WHEN recency = 1 THEN brand END),
                  MAX(CASE WHEN recency = 1 THEN store_chain END),
                  AVG(CASE WHEN pos IN ((n + 1) / 2, (n + 2) / 2) THEN current_price_cents END),
                  MIN(current_price_cents), MAX(current_price_cents),
                  COUNT(*), COUNT(*), ?3
           FROM ranked WHERE true
           GROUP BY product_id
           HAVING COUNT(*) >= 5
           ON CONFLICT (product_id, observation_date) DO UPDATE SET
             product_name = excluded.product_name,
             brand = excluded.brand,
             store_chain = excluded.store_chain,
             median_price_cents = excluded.median_price_cents,
             min_price_cents = excluded.min_price_cents,
             max_price_cents = excluded.max_price_cents,
             observation_count = excluded.observation_count,
             contributor_count = excluded.contributor_count,
             created_at = excluded.created_at`,
        )
        .bind(day, nextDay, now.toISOString())
        .run();
    }
    await db
      .prepare(
        `INSERT INTO retention_progress (observation_date, materialized_at) VALUES (?1, ?2)`,
      )
      .bind(day, now.toISOString())
      .run();
  }

  let deleted = 0;
  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const result = await db
      .prepare(
        `DELETE FROM observations_v2 WHERE id IN (
           SELECT id FROM observations_v2
           WHERE client_observed_at >= ?1 AND client_observed_at < ?2
           LIMIT ?3)`,
      )
      .bind(day, nextDay, chunkSize)
      .run();
    const changes = result.meta.changes ?? 0;
    deleted += changes;
    if (changes < chunkSize) {
      await db
        .prepare(`DELETE FROM retention_progress WHERE observation_date = ?1`)
        .bind(day)
        .run();
      break;
    }
  }
  return deleted;
}
