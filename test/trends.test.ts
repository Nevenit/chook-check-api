import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

/** Seed observations in a specific time period. */
async function seedInPeriod(
  productId: string,
  productName: string,
  priceCents: number,
  daysAgo: number,
  contributorCount: number,
) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  for (let i = 0; i < contributorCount; i++) {
    const cid = `00000000-0000-0000-0000-00000000000${i + 1}`;
    await env.DB.prepare(
      `INSERT INTO observations (product_id, product_name, brand, category, store_chain,
        price_cents, is_personalised, contributor_id, observed_at, submitted_at)
       VALUES (?, ?, 'Brand', 'Dairy', 'coles', ?, 0, ?, ?, ?)`,
    )
      .bind(
        productId,
        productName,
        priceCents,
        cid,
        date.toISOString(),
        new Date().toISOString(),
      )
      .run();
  }
}

describe("GET /api/trends", () => {
  it("returns price trends with quorum in both periods", async () => {
    // Previous period (8-14 days ago): price 400
    await seedInPeriod("coles:1", "Milk 2L", 400, 10, 3);
    // Current period (0-7 days ago): price 450
    await seedInPeriod("coles:1", "Milk 2L", 450, 2, 3);

    const res = await SELF.fetch("http://localhost/api/trends?period=7d");
    expect(res.status).toBe(200);
    const json = await res.json<{
      trends: { direction: string; changePercent: number }[];
    }>();
    expect(json.trends.length).toBe(1);
    expect(json.trends[0].direction).toBe("up");
    expect(json.trends[0].changePercent).toBeGreaterThan(0);
  });

  it("returns empty when quorum not met", async () => {
    await seedInPeriod("coles:1", "Milk 2L", 400, 10, 2);
    await seedInPeriod("coles:1", "Milk 2L", 450, 2, 2);

    const res = await SELF.fetch("http://localhost/api/trends?period=7d");
    const json = await res.json<{ trends: unknown[] }>();
    expect(json.trends.length).toBe(0);
  });

  it("filters by chain", async () => {
    await seedInPeriod("coles:1", "Milk 2L", 400, 10, 3);
    await seedInPeriod("coles:1", "Milk 2L", 450, 2, 3);

    const res = await SELF.fetch(
      "http://localhost/api/trends?period=7d&chain=woolworths",
    );
    const json = await res.json<{ trends: unknown[] }>();
    expect(json.trends.length).toBe(0);
  });

  it("filters by category", async () => {
    await seedInPeriod("coles:1", "Milk 2L", 400, 10, 3);
    await seedInPeriod("coles:1", "Milk 2L", 450, 2, 3);

    const res = await SELF.fetch(
      "http://localhost/api/trends?period=7d&category=Dairy",
    );
    const json = await res.json<{ trends: unknown[] }>();
    expect(json.trends.length).toBe(1);
  });
});
