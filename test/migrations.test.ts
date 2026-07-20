import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import migration0000 from "../migrations/0000_create_tables.sql?raw";
import migration0001 from "../migrations/0001_v2_privacy_and_auth.sql?raw";

async function applyMigration(sql: string): Promise<void> {
  const withoutComments = sql.replace(/^--.*$/gm, "");
  for (const statement of withoutComments.split(";")) {
    const normalized = statement.replace(/\s+/g, " ").trim();
    if (normalized) await env.DB.exec(normalized);
  }
}

describe("D1 migrations", () => {
  it("apply in order to a clean database", async () => {
    await applyMigration(migration0000);
    await applyMigration(migration0001);

    const tables = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string }>();
    const names = new Set(tables.results?.map((row) => row.name));
    expect(names).toContain("observations");
    expect(names).toContain("rate_limits");
    expect(names).toContain("contributors");
    expect(names).toContain("observations_v2");
    expect(names).toContain("daily_product_aggregates");
  });
});
