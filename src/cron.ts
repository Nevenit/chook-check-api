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
const MATERIALIZATION_BATCH_DAYS = 100;

interface ExpiredProductDay {
  product_id: string;
  observation_date: string;
}

interface MaterializationRow {
  contributor_id: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
  current_price_cents: number;
  client_observed_at: string;
}

export async function cleanupRawObservations(db: D1Database): Promise<number> {
  const cutoff = new Date(
    Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const aggregateCutoff = new Date(
    Date.now() - AGGREGATE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { results: expiredDays } = await db
    .prepare(
      `SELECT product_id, substr(client_observed_at, 1, 10) AS observation_date
       FROM observations_v2
       WHERE substr(client_observed_at, 1, 10) < substr(?, 1, 10)
       GROUP BY product_id, observation_date
       ORDER BY observation_date ASC, product_id ASC
       LIMIT ?`,
    )
    .bind(cutoff, MATERIALIZATION_BATCH_DAYS)
    .all<ExpiredProductDay>();

  let deleted = 0;
  for (const day of expiredDays ?? []) {
    const { results } = await db
      .prepare(
        `SELECT contributor_id, product_name, brand, store_chain,
                current_price_cents, client_observed_at
         FROM observations_v2
         WHERE product_id = ?
           AND substr(client_observed_at, 1, 10) = ?
           AND quarantined = 0
         ORDER BY client_observed_at ASC`,
      )
      .bind(day.product_id, day.observation_date)
      .all<MaterializationRow>();

    const latestByContributor = new Map<string, MaterializationRow>();
    for (const row of results ?? []) {
      latestByContributor.set(row.contributor_id, row);
    }
    const balanced = [...latestByContributor.values()];

    if (
      day.observation_date >= aggregateCutoff.slice(0, 10) &&
      balanced.length >= 5
    ) {
      const latest = balanced.at(-1)!;
      const prices = balanced.map((row) => row.current_price_cents);
      await db
        .prepare(
          `INSERT INTO daily_product_aggregates (
             product_id, observation_date, product_name, brand, store_chain,
             median_price_cents, min_price_cents, max_price_cents,
             observation_count, contributor_count, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_id, observation_date) DO UPDATE SET
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
        .bind(
          day.product_id,
          day.observation_date,
          latest.product_name,
          latest.brand,
          latest.store_chain,
          median(prices),
          Math.min(...prices),
          Math.max(...prices),
          balanced.length,
          balanced.length,
          new Date().toISOString(),
        )
        .run();
    }

    const deleteResult = await db
      .prepare(
        `DELETE FROM observations_v2
         WHERE product_id = ? AND substr(client_observed_at, 1, 10) = ?`,
      )
      .bind(day.product_id, day.observation_date)
      .run();
    deleted += deleteResult.meta?.changes ?? 0;
  }

  await db
    .prepare(
      `DELETE FROM daily_product_aggregates
       WHERE observation_date < substr(?, 1, 10)`,
    )
    .bind(aggregateCutoff)
    .run();
  return deleted;
}
import { median } from "./lib/aggregation";
