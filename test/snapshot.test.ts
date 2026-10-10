import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { buildSnapshot, chunkText } from "../src/lib/snapshot";
import { D1_QUERY_BUDGET } from "../src/lib/limits";
import { cleanDb } from "./helpers";
import { countQueries } from "./query-budget";

beforeEach(cleanDb);

const NOW = new Date();
const product = (id: string, name = "Milk") => ({
  productId: id,
  productName: name,
  brand: null,
  storeChain: "coles",
  quorum: true,
  currentMedianCents: 500,
  minCents: 450,
  maxCents: 550,
  observationCount: 12,
  contributorCount: 6,
  promoFrequency: { none: 1 },
});

async function putStats(id: string, isPublic: boolean, name?: string) {
  await env.DB.prepare(
    "INSERT INTO product_stats (product_id, public, stats_json, refreshed_at) VALUES (?, ?, ?, ?)",
  )
    .bind(
      id,
      isPublic ? 1 : 0,
      isPublic ? JSON.stringify(product(id, name)) : null,
      NOW.toISOString(),
    )
    .run();
}
const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`http://localhost${path}`, {
    headers: { "CF-Connecting-IP": "198.51.100.9", ...headers },
  });

describe("chunkText", () => {
  it("never splits a surrogate pair", () => {
    const chunks = chunkText("a🌶b", 2);
    expect(chunks.join("")).toBe("a🌶b");
    for (const chunk of chunks) expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe("bulk snapshot", () => {
  it("serves an empty snapshot before the first build", async () => {
    const response = await get("/api/v2/snapshots/products");
    expect(response.status).toBe(200);
    expect((await response.json<{ products: unknown[] }>()).products).toEqual(
      [],
    );
  });

  it("serves only public products and revalidates with the ETag", async () => {
    await putStats("coles:1", true);
    await putStats("coles:2", false);
    await buildSnapshot(env.DB, NOW);
    const response = await get("/api/v2/snapshots/products");
    const etag = response.headers.get("ETag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect((await response.json<{ products: unknown[] }>()).products).toEqual([
      product("coles:1"),
    ]);
    const revalidated = await get("/api/v2/snapshots/products", {
      "If-None-Match": etag!,
    });
    expect(revalidated.status).toBe(304);
  });

  it("keeps the ETag when the published content is unchanged", async () => {
    await putStats("coles:1", true);
    expect((await buildSnapshot(env.DB, NOW)).changed).toBe(true);
    expect(
      (await buildSnapshot(env.DB, new Date(NOW.getTime() + 60_000))).changed,
    ).toBe(false);
  });

  it("reassembles small chunks without corrupting names", async () => {
    await putStats("coles:1", true, "Jalapeño 🌶 Chips");
    await buildSnapshot(env.DB, NOW, 7);
    const body = await (
      await get("/api/v2/snapshots/products")
    ).json<{
      products: Array<{ productName: string }>;
    }>();
    expect(body.products[0].productName).toBe("Jalapeño 🌶 Chips");
  });

  it("keeps only the current and previous generation", async () => {
    await putStats("coles:1", true);
    await buildSnapshot(env.DB, NOW);
    await putStats("coles:2", true);
    await buildSnapshot(env.DB, NOW);
    await putStats("coles:3", true);
    await buildSnapshot(env.DB, NOW);
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT generation FROM snapshot_chunks ORDER BY generation",
    ).all<{ generation: number }>();
    expect(results.map((row) => row.generation)).toEqual([2, 3]);
  });

  it("builds within the query budget", async () => {
    for (let i = 0; i < 50; i++) await putStats(`coles:${i}`, true);
    const counter = countQueries(env.DB);
    await buildSnapshot(counter.db, NOW);
    expect(counter.count()).toBeLessThanOrEqual(D1_QUERY_BUDGET);
  });
});

describe("per-product stats", () => {
  it("serves public stats and hides other products", async () => {
    await putStats("coles:1", true);
    await putStats("coles:2", false);
    const found = await get("/api/v2/products/coles%3A1/stats");
    expect(await found.json()).toEqual(product("coles:1"));
    expect((await get("/api/v2/products/coles%3A2/stats")).status).toBe(404);
    expect((await get("/api/v2/products/coles%3A3/stats")).status).toBe(404);
  });
});
