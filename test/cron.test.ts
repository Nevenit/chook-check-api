import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { cleanupRateLimits, cleanupRawObservations } from "../src/cron";
import { createContributor } from "../src/lib/auth";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

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

describe("cleanupRawObservations", () => {
  it("deletes raw observations older than 180 days", async () => {
    const credentials = await registerContributor();
    await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });
    const old = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE observations_v2 SET client_observed_at = ?")
      .bind(old)
      .run();
    expect(await cleanupRawObservations(env.DB)).toBe(1);
  });

  it("retains a three-year public daily aggregate before deleting raw rows", async () => {
    const old = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
    const prices = [500, 600, 700, 800, 900];
    for (const price of prices) {
      const credentials = await createContributor(env.DB);
      const response = await postV2(credentials.submitToken, {
        mode: "history",
        observations: [
          makeV2Observation({
            currentPriceCents: price,
          }),
        ],
      });
      expect(response.status).toBe(201);
      await env.DB.prepare(
        `UPDATE observations_v2 SET client_observed_at = ?
         WHERE contributor_id = ?`,
      )
        .bind(old, credentials.contributorId)
        .run();
    }

    expect(await cleanupRawObservations(env.DB)).toBe(5);
    const aggregate = await env.DB.prepare(
      `SELECT median_price_cents, min_price_cents, max_price_cents,
              contributor_count
       FROM daily_product_aggregates`,
    ).first<{
      median_price_cents: number;
      min_price_cents: number;
      max_price_cents: number;
      contributor_count: number;
    }>();
    expect(aggregate).toEqual({
      median_price_cents: 700,
      min_price_cents: 500,
      max_price_cents: 900,
      contributor_count: 5,
    });

    const response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths:123/stats",
    );
    expect(response.status).toBe(200);
    const stats = await response.json<{ priceHistory: unknown[] }>();
    expect(stats.priceHistory).toHaveLength(1);
  });
});
