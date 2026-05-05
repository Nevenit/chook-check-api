const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Delete rate_limits rows whose window has expired (older than 2 hours).
 * The active rate-limit window is 1 hour, so 2 hours guarantees rows are
 * unused before deletion. Triggered hourly by the cron handler.
 */
export async function cleanupRateLimits(db: D1Database): Promise<number> {
  const cutoff = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  const result = await db
    .prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
