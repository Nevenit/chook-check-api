import { describe, it, expect, beforeEach } from "vitest";
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { cleanupRateLimits, runRetentionStep } from "../src/cron";
import worker from "../src/index";
import { D1_QUERY_BUDGET } from "../src/lib/limits";
import { SNAPSHOT_CRON } from "../src/lib/snapshot";
import { countQueries } from "./query-budget";
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

const DAY = 24 * 60 * 60 * 1000;

async function insertAged(contributor: string, price: number, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString();
  await env.DB.prepare(
    `INSERT INTO observations_v2 (
       schema_version, client_observation_id, contribution_mode, contributor_id,
       product_id, product_name, store_chain, current_price_cents,
       source_surface, extraction_source, scraper_version, instrument_mode,
       capture_phase, fulfilment_mode, auth_state, loyalty_state,
       client_observed_at, submitted_at)
     VALUES (2, ?, 'history', ?, 'woolworths:123', 'Vegemite', 'woolworths', ?,
             'product_page', 'json_ld', '2.2.0', 'silent', 'baseline',
             'unknown', 'unknown', 'unknown', ?, ?)`,
  )
    .bind(crypto.randomUUID(), contributor, price, at, at)
    .run();
}
const aggregate = () =>
  env.DB.prepare(
    `SELECT median_price_cents, min_price_cents, max_price_cents, contributor_count
     FROM daily_product_aggregates`,
  ).first();
const rawCount = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM observations_v2").first<{
      n: number;
    }>()
  )?.n;

describe("runRetentionStep", () => {
  it("deletes expired raw observations", async () => {
    await insertAged("c0", 500, 181);
    expect(await runRetentionStep(env.DB)).toBe(1);
    expect(await rawCount()).toBe(0);
  });

  it("keeps observations that have not expired", async () => {
    await insertAged("c0", 500, 179);
    expect(await runRetentionStep(env.DB)).toBe(0);
    expect(await rawCount()).toBe(1);
  });

  it("materializes a public daily aggregate before deleting", async () => {
    for (const [i, price] of [500, 600, 700, 800, 900].entries()) {
      await insertAged(`c${i}`, price, 181);
    }
    expect(await runRetentionStep(env.DB)).toBe(5);
    expect(await aggregate()).toEqual({
      median_price_cents: 700,
      min_price_cents: 500,
      max_price_cents: 900,
      contributor_count: 5,
    });
  });

  it("aggregates a day once even when deletion spans runs", async () => {
    for (const [i, price] of [100, 200, 300, 400, 500, 600, 700].entries()) {
      await insertAged(`c${i}`, price, 181);
    }
    const options = { chunkSize: 2, maxChunks: 1 };
    expect(await runRetentionStep(env.DB, new Date(), options)).toBe(2);
    const first = await aggregate();
    expect(first).toMatchObject({
      median_price_cents: 400,
      contributor_count: 7,
    });
    while (((await rawCount()) ?? 0) > 0) {
      await runRetentionStep(env.DB, new Date(), options);
    }
    await runRetentionStep(env.DB, new Date(), options);
    expect(await aggregate()).toEqual(first);
    const progress = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM retention_progress",
    ).first<{ n: number }>();
    expect(progress?.n).toBe(0);
  });

  it("removes daily aggregates older than three years", async () => {
    await env.DB.prepare(
      `INSERT INTO daily_product_aggregates (
         product_id, observation_date, product_name, store_chain,
         median_price_cents, min_price_cents, max_price_cents,
         observation_count, contributor_count, created_at)
       VALUES ('coles:1', '2020-01-01', 'Old', 'coles', 1, 1, 1, 5, 5, '2020-01-01')`,
    ).run();
    await runRetentionStep(env.DB);
    expect(await aggregate()).toBeNull();
  });

  it("processes a day within the query budget", async () => {
    for (let i = 0; i < 5; i++) await insertAged(`c${i}`, 500, 181);
    const counter = countQueries(env.DB);
    await runRetentionStep(counter.db);
    expect(counter.count()).toBeLessThanOrEqual(D1_QUERY_BUDGET);
  });
});

// Call the handler through Workers' own signature, as the runtime does.
const handler = worker as ExportedHandler<Cloudflare.Env>;

describe("scheduled handler", () => {
  it("publishes a snapshot on the snapshot cron", async () => {
    const ctx = createExecutionContext();
    await handler.scheduled!(
      { cron: SNAPSHOT_CRON, scheduledTime: Date.now(), noRetry() {} },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const meta = await env.DB.prepare(
      "SELECT product_count FROM snapshot_meta",
    ).first();
    expect(meta).toEqual({ product_count: 0 });
  });

  it("refreshes stats and applies retention on the minute cron", async () => {
    await insertAged("c0", 500, 181);
    await env.DB.prepare(
      "INSERT INTO dirty_products (product_id, marked_at) VALUES ('woolworths:123', ?)",
    )
      .bind(new Date().toISOString())
      .run();
    const ctx = createExecutionContext();
    await handler.scheduled!(
      { cron: "* * * * *", scheduledTime: Date.now(), noRetry() {} },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(await rawCount()).toBe(0);
    const stats = await env.DB.prepare(
      "SELECT public FROM product_stats",
    ).first();
    expect(stats).toEqual({ public: 0 });
  });
});
