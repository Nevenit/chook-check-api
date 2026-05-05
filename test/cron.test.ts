import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { cleanupRateLimits } from "../src/cron";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

async function insertRateLimit(
  key: string,
  windowStart: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, endpoint, count, window_start) VALUES (?, ?, ?, ?)`,
  )
    .bind(key, "POST /api/observations", 1, windowStart)
    .run();
}

describe("cleanupRateLimits", () => {
  it("deletes rows older than 2 hours, keeps recent rows", async () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000,
    ).toISOString();
    const thirtyMinutesAgo = new Date(
      Date.now() - 30 * 60 * 1000,
    ).toISOString();

    await insertRateLimit("old", threeHoursAgo);
    await insertRateLimit("recent", thirtyMinutesAgo);

    const deleted = await cleanupRateLimits(env.DB);
    expect(deleted).toBe(1);

    const remaining = await env.DB.prepare(`SELECT key FROM rate_limits`).all<{
      key: string;
    }>();
    expect(remaining.results?.map((r) => r.key)).toEqual(["recent"]);
  });

  it("returns 0 when no rows are old enough", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await insertRateLimit("recent", recent);

    const deleted = await cleanupRateLimits(env.DB);
    expect(deleted).toBe(0);
  });

  it("returns 0 on empty table", async () => {
    const deleted = await cleanupRateLimits(env.DB);
    expect(deleted).toBe(0);
  });
});
