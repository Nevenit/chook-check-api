import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

const CONTRIBUTOR_ID = "00000000-0000-0000-0000-000000000001";

async function seedObservations(count: number) {
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      `INSERT INTO observations (product_id, product_name, store_chain,
        price_cents, is_personalised, contributor_id, observed_at, submitted_at)
       VALUES (?, ?, 'woolworths', 500, 0, ?, ?, ?)`,
    )
      .bind(
        `woolworths:${i}`,
        `Product ${i}`,
        CONTRIBUTOR_ID,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  }
}

describe("DELETE /api/contributor/:contributorId", () => {
  it("deletes all observations for a contributor", async () => {
    await seedObservations(5);
    const res = await SELF.fetch(
      `http://localhost/api/contributor/${CONTRIBUTOR_ID}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ deleted: number }>();
    expect(json.deleted).toBe(5);

    // Verify DB is clean
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM observations WHERE contributor_id = ?",
    )
      .bind(CONTRIBUTOR_ID)
      .first<{ cnt: number }>();
    expect(row?.cnt).toBe(0);
  });

  it("returns deleted=0 for unknown contributor", async () => {
    const res = await SELF.fetch(
      `http://localhost/api/contributor/${CONTRIBUTOR_ID}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ deleted: number }>();
    expect(json.deleted).toBe(0);
  });

  it("does not delete other contributors' data", async () => {
    await seedObservations(3);
    await env.DB.prepare(
      `INSERT INTO observations (product_id, product_name, store_chain,
        price_cents, is_personalised, contributor_id, observed_at, submitted_at)
       VALUES ('woolworths:99', 'Other', 'woolworths', 500, 0,
        '00000000-0000-0000-0000-000000000002', ?, ?)`,
    )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run();

    await SELF.fetch(
      `http://localhost/api/contributor/${CONTRIBUTOR_ID}`,
      { method: "DELETE" },
    );

    const row = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM observations",
    ).first<{ cnt: number }>();
    expect(row?.cnt).toBe(1);
  });
});
