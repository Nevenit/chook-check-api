import { env } from "cloudflare:test";

const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, product_name TEXT NOT NULL, brand TEXT, category TEXT, gtin TEXT, store_chain TEXT NOT NULL, price_cents INTEGER NOT NULL, was_price_cents INTEGER, unit_price_cents INTEGER, unit_measure TEXT, promo_type TEXT, is_personalised INTEGER NOT NULL DEFAULT 0, contributor_id TEXT NOT NULL, browser TEXT, state TEXT, city TEXT, store_name TEXT, observed_at TEXT NOT NULL, submitted_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, endpoint TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, window_start TEXT NOT NULL, PRIMARY KEY (key, endpoint))",
  "CREATE TABLE IF NOT EXISTS contributors (id TEXT PRIMARY KEY, submit_token_hash TEXT NOT NULL UNIQUE, deletion_token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, deleted_at TEXT)",
  `CREATE TABLE IF NOT EXISTS observations_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_version INTEGER NOT NULL,
    client_observation_id TEXT NOT NULL,
    contribution_mode TEXT NOT NULL,
    contributor_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    brand TEXT, category TEXT, gtin TEXT,
    store_chain TEXT NOT NULL,
    current_price_cents INTEGER NOT NULL,
    regular_price_cents INTEGER,
    unit_price_cents INTEGER,
    unit_measure TEXT,
    offer_type TEXT,
    offer_text_normalized TEXT,
    offer_id TEXT,
    required_quantity INTEGER,
    source_surface TEXT NOT NULL,
    extraction_source TEXT NOT NULL,
    scraper_version TEXT NOT NULL,
    instrument_mode TEXT NOT NULL,
    capture_phase TEXT NOT NULL,
    comparison_id TEXT,
    store_id TEXT,
    coarse_region TEXT,
    fulfilment_mode TEXT NOT NULL,
    auth_state TEXT NOT NULL,
    loyalty_state TEXT NOT NULL,
    browser_family TEXT,
    client_observed_at TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    quarantined INTEGER NOT NULL DEFAULT 0,
    quarantine_reason TEXT,
    UNIQUE (contributor_id, client_observation_id)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_product_aggregates (
    product_id TEXT NOT NULL,
    observation_date TEXT NOT NULL,
    product_name TEXT NOT NULL,
    brand TEXT,
    store_chain TEXT NOT NULL,
    median_price_cents INTEGER NOT NULL,
    min_price_cents INTEGER NOT NULL,
    max_price_cents INTEGER NOT NULL,
    observation_count INTEGER NOT NULL,
    contributor_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (product_id, observation_date)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_v2_observed ON observations_v2(client_observed_at)",
  "CREATE TABLE IF NOT EXISTS dirty_products (product_id TEXT PRIMARY KEY, marked_at TEXT NOT NULL, due_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_dirty_products_due ON dirty_products(due_at)",
  "CREATE TABLE IF NOT EXISTS product_stats (product_id TEXT PRIMARY KEY, public INTEGER NOT NULL CHECK (public IN (0, 1)), stats_json TEXT, refreshed_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_product_stats_public_refreshed ON product_stats(public, refreshed_at)",
  "CREATE TABLE IF NOT EXISTS snapshot_chunks (generation INTEGER NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (generation, seq))",
  "CREATE TABLE IF NOT EXISTS snapshot_meta (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL, etag TEXT NOT NULL, generated_at TEXT NOT NULL, product_count INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS retention_progress (observation_date TEXT PRIMARY KEY, materialized_at TEXT NOT NULL)",
];

/** Ensure the database schema exists and clean all tables between tests. */
export async function cleanDb() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await env.DB.exec(stmt.replace(/\s+/g, " "));
  }
  await env.DB.exec("DELETE FROM observations");
  await env.DB.exec("DELETE FROM rate_limits");
  await env.DB.exec("DELETE FROM observations_v2");
  await env.DB.exec("DELETE FROM daily_product_aggregates");
  await env.DB.exec("DELETE FROM contributors");
  for (const table of [
    "dirty_products",
    "product_stats",
    "snapshot_chunks",
    "snapshot_meta",
    "retention_progress",
  ]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
}
