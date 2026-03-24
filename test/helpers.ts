import { env } from "cloudflare:test";

const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, product_name TEXT NOT NULL, brand TEXT, category TEXT, gtin TEXT, store_chain TEXT NOT NULL, price_cents INTEGER NOT NULL, was_price_cents INTEGER, unit_price_cents INTEGER, unit_measure TEXT, promo_type TEXT, is_personalised INTEGER NOT NULL DEFAULT 0, contributor_id TEXT NOT NULL, browser TEXT, state TEXT, city TEXT, store_name TEXT, observed_at TEXT NOT NULL, submitted_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, endpoint TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, window_start TEXT NOT NULL, PRIMARY KEY (key, endpoint))",
];

/** Ensure the database schema exists and clean all tables between tests. */
export async function cleanDb() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await env.DB.exec(stmt);
  }
  await env.DB.exec("DELETE FROM observations");
  await env.DB.exec("DELETE FROM rate_limits");
}
