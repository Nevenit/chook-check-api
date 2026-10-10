-- Retention reads observations by time. No v2 query filters by chain or
-- comparison ID, and every index costs a written row on each insert/delete.
CREATE INDEX idx_v2_observed ON observations_v2(client_observed_at);
DROP INDEX idx_v2_chain_time;
DROP INDEX idx_v2_comparison;

-- Products whose public stats need recomputing.
CREATE TABLE dirty_products (
  product_id TEXT PRIMARY KEY,
  marked_at TEXT NOT NULL
);

-- Precomputed public stats; stats_json is the published entry when public.
CREATE TABLE product_stats (
  product_id TEXT PRIMARY KEY,
  public INTEGER NOT NULL CHECK (public IN (0, 1)),
  stats_json TEXT,
  refreshed_at TEXT NOT NULL
);
CREATE INDEX idx_product_stats_refreshed ON product_stats(refreshed_at);

-- The published bulk snapshot, chunked below D1's 2 MB value limit.
CREATE TABLE snapshot_chunks (
  generation INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (generation, seq)
);
CREATE TABLE snapshot_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL,
  etag TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  product_count INTEGER NOT NULL
);

-- Expired days already materialized, so a deletion spread over several runs
-- never re-aggregates a partial day.
CREATE TABLE retention_progress (
  observation_date TEXT PRIMARY KEY,
  materialized_at TEXT NOT NULL
);

-- Existing observations need their public stats computed once.
INSERT INTO dirty_products (product_id, marked_at)
SELECT DISTINCT product_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM observations_v2;
