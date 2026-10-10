import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { refreshProductStats } from "../src/lib/product-stats";
import { markProductsDirty } from "../src/db/dirty-products";
import { deleteContributorV2 } from "../src/db/queries-v2";
import { D1_QUERY_BUDGET } from "../src/lib/limits";
import { cleanDb } from "./helpers";
import { countQueries } from "./query-budget";

beforeEach(cleanDb);

const NOW = new Date();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (msBeforeNow: number) =>
  new Date(NOW.getTime() - msBeforeNow).toISOString();

async function insertRow(row: {
  contributor: string;
  price: number;
  observedAt: string;
  productId?: string;
  name?: string;
  offerType?: string | null;
}) {
  await env.DB.prepare(
    `INSERT INTO observations_v2 (
       schema_version, client_observation_id, contribution_mode, contributor_id,
       product_id, product_name, store_chain, current_price_cents, offer_type,
       source_surface, extraction_source, scraper_version, instrument_mode,
       capture_phase, fulfilment_mode, auth_state, loyalty_state,
       client_observed_at, submitted_at)
     VALUES (2, ?, 'history', ?, ?, ?, 'coles', ?, ?, 'product_page', 'json_ld',
             '2.2.0', 'silent', 'baseline', 'unknown', 'unknown', 'unknown', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      row.contributor,
      row.productId ?? "coles:1",
      row.name ?? "Milk",
      row.price,
      row.offerType ?? null,
      row.observedAt,
      row.observedAt,
    )
    .run();
}

async function stats(productId = "coles:1") {
  const row = await env.DB.prepare(
    "SELECT public, stats_json FROM product_stats WHERE product_id = ?",
  )
    .bind(productId)
    .first<{ public: number; stats_json: string | null }>();
  return (
    row && {
      public: row.public,
      stats: row.stats_json && JSON.parse(row.stats_json),
    }
  );
}

describe("refreshProductStats", () => {
  it("publishes each contributor's latest price from the last seven days", async () => {
    for (const [i, price] of [500, 510, 520, 530, 540].entries()) {
      await insertRow({ contributor: `c${i}`, price, observedAt: at(2 * DAY) });
    }
    for (let i = 0; i < 4; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 900,
        observedAt: at(HOUR),
        name: "Milk 2L",
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    expect(await refreshProductStats(env.DB, NOW)).toBe(1);
    expect(await stats()).toEqual({
      public: 1,
      stats: {
        productId: "coles:1",
        productName: "Milk 2L",
        brand: null,
        storeChain: "coles",
        quorum: true,
        currentMedianCents: 900,
        minCents: 540,
        maxCents: 900,
        observationCount: 9,
        contributorCount: 5,
        promoFrequency: { none: 1 },
      },
    });
  });

  it("uses each contributor's latest sample and averages even medians", async () => {
    await insertRow({
      contributor: "c0",
      price: 100,
      observedAt: at(3 * HOUR),
    });
    for (const [i, price] of [600, 600, 610, 620, 630, 640].entries()) {
      await insertRow({ contributor: `c${i}`, price, observedAt: at(HOUR) });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect((await stats())?.stats).toMatchObject({
      currentMedianCents: 615,
      minCents: 600,
      maxCents: 640,
    });
  });

  it("is not public when fewer than five contributors saw it in the last seven days", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(8 * DAY),
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect(await stats()).toEqual({ public: 0, stats: null });
  });

  it("computes promo frequency over balanced samples", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(HOUR),
        offerType: i < 2 ? "special" : null,
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect((await stats())?.stats.promoFrequency).toEqual({
      special: 0.4,
      none: 0.6,
    });
  });

  it("refreshes a dirty product at most once a day", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(HOUR),
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    await markProductsDirty(
      env.DB,
      ["coles:1"],
      new Date(NOW.getTime() + 60_000),
    );
    expect(
      await refreshProductStats(env.DB, new Date(NOW.getTime() + 7 * HOUR)),
    ).toBe(0);
    expect(
      await refreshProductStats(env.DB, new Date(NOW.getTime() + 25 * HOUR)),
    ).toBe(1);
    const dirty = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM dirty_products",
    ).first<{ n: number }>();
    expect(dirty?.n).toBe(0);
  });

  it("keeps a product dirty when it is marked after the run started", async () => {
    await insertRow({ contributor: "c0", price: 500, observedAt: at(HOUR) });
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await markProductsDirty(
      env.DB,
      ["coles:1"],
      new Date(NOW.getTime() + 5_000),
    );
    await refreshProductStats(env.DB, NOW);
    const dirty = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM dirty_products",
    ).first<{ n: number }>();
    expect(dirty?.n).toBe(1);
  });

  it("refreshes stale stats daily so old prices expire", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(6 * DAY),
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect((await stats())?.public).toBe(1);
    await refreshProductStats(env.DB, new Date(NOW.getTime() + 2 * DAY));
    expect((await stats())?.public).toBe(0);
  });

  it("rechecks only public products when nothing changed", async () => {
    for (let i = 0; i < 4; i++) {
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(HOUR),
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect((await stats())?.public).toBe(0);
    expect(
      await refreshProductStats(env.DB, new Date(NOW.getTime() + 2 * DAY)),
    ).toBe(0);
  });

  it("drops a product below quorum after a contributor deletes their data", async () => {
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        "INSERT INTO contributors (id, submit_token_hash, deletion_token_hash, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(`c${i}`, `s${i}`, `d${i}`, NOW.toISOString())
        .run();
      await insertRow({
        contributor: `c${i}`,
        price: 500,
        observedAt: at(HOUR),
      });
    }
    await markProductsDirty(env.DB, ["coles:1"], NOW);
    await refreshProductStats(env.DB, NOW);
    expect((await stats())?.public).toBe(1);
    await deleteContributorV2(env.DB, "c0");
    // Deletions are not throttled: the next refresh removes the prices.
    await refreshProductStats(env.DB, new Date(Date.now() + HOUR));
    expect((await stats())?.public).toBe(0);
  });

  it("reads few rows on an idle minute once products have settled", async () => {
    const settled = Array.from({ length: 2000 }, (_, i) => `coles:${5000 + i}`);
    const throttled = Array.from(
      { length: 300 },
      (_, i) => `coles:${9000 + i}`,
    );
    const insertStats = (ids: string[], refreshedAt: string) =>
      env.DB.prepare(
        `INSERT INTO product_stats (product_id, public, stats_json, refreshed_at)
         SELECT value, 0, NULL, ?2 FROM json_each(?1)`,
      )
        .bind(JSON.stringify(ids), refreshedAt)
        .run();
    await insertStats(settled, at(2 * DAY));
    await insertStats(throttled, at(HOUR));
    await markProductsDirty(env.DB, throttled, NOW);
    const counter = countQueries(env.DB);
    expect(await refreshProductStats(counter.db, NOW)).toBe(0);
    expect(counter.rowsRead()).toBeLessThan(50);
  });

  it("refreshes a full batch within the query budget", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `coles:${i + 10}`);
    for (const productId of ids) {
      await insertRow({
        contributor: "c0",
        price: 500,
        observedAt: at(HOUR),
        productId,
      });
    }
    await markProductsDirty(env.DB, ids, NOW);
    const counter = countQueries(env.DB);
    expect(await refreshProductStats(counter.db, NOW)).toBe(100);
    expect(counter.count()).toBeLessThanOrEqual(7);
    expect(counter.count()).toBeLessThanOrEqual(D1_QUERY_BUDGET);
  });
});
