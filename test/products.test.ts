import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

/** Seed observations from N distinct contributors. */
async function seedProduct(
  productId: string,
  productName: string,
  contributorCount: number,
  priceCents: number = 750,
) {
  for (let i = 0; i < contributorCount; i++) {
    const cid = `00000000-0000-0000-0000-00000000000${i + 1}`;
    await env.DB.prepare(
      `INSERT INTO observations (product_id, product_name, brand, store_chain,
        price_cents, is_personalised, contributor_id, promo_type, observed_at, submitted_at)
       VALUES (?, ?, 'TestBrand', 'woolworths', ?, 0, ?, 'none', ?, ?)`,
    )
      .bind(
        productId,
        productName,
        priceCents + i * 10,
        cid,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  }
}

describe("GET /api/products/:productId/stats", () => {
  it("returns product stats when quorum is met", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 3);
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:123/stats",
    );
    expect(res.status).toBe(200);
    const json = await res.json<{
      quorum: boolean;
      currentMedianCents: number;
      contributorCount: number;
    }>();
    expect(json.quorum).toBe(true);
    expect(json.currentMedianCents).toBeTypeOf("number");
    expect(json.contributorCount).toBe(3);
  });

  it("returns quorum=false when fewer than 3 contributors", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 2);
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:123/stats",
    );
    expect(res.status).toBe(200);
    const json = await res.json<{
      quorum: boolean;
      currentMedianCents: number | null;
    }>();
    expect(json.quorum).toBe(false);
    expect(json.currentMedianCents).toBeNull();
  });

  it("returns 404 for unknown product", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:999/stats",
    );
    expect(res.status).toBe(404);
  });

  it("returns price history bucketed by day", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 3);
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:123/stats",
    );
    const json = await res.json<{ priceHistory: unknown[] }>();
    expect(json.priceHistory.length).toBeGreaterThan(0);
  });

  it("filters by chain when specified", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 3);
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:123/stats?chain=coles",
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/products/search", () => {
  it("finds products by name", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 3);
    const res = await SELF.fetch(
      "http://localhost/api/products/search?q=vegemite",
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ results: unknown[] }>();
    expect(json.results.length).toBe(1);
  });

  it("returns empty results when no quorum", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 2);
    const res = await SELF.fetch(
      "http://localhost/api/products/search?q=vegemite",
    );
    const json = await res.json<{ results: unknown[] }>();
    expect(json.results.length).toBe(0);
  });

  it("rejects search query shorter than 2 chars", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/products/search?q=v",
    );
    expect(res.status).toBe(400);
  });

  it("filters by chain", async () => {
    await seedProduct("woolworths:123", "Vegemite 380g", 3);
    const res = await SELF.fetch(
      "http://localhost/api/products/search?q=vegemite&chain=coles",
    );
    const json = await res.json<{ results: unknown[] }>();
    expect(json.results.length).toBe(0);
  });
});
