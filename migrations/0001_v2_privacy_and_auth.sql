-- Authenticated pseudonymous contributors. Raw tokens are never stored.
CREATE TABLE contributors (
  id TEXT PRIMARY KEY,
  submit_token_hash TEXT NOT NULL UNIQUE,
  deletion_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Versioned observations with normalized offer, context, and instrument fields.
CREATE TABLE observations_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  client_observation_id TEXT NOT NULL,
  contribution_mode TEXT NOT NULL CHECK (contribution_mode IN ('history', 'fairness')),
  contributor_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  gtin TEXT,
  store_chain TEXT NOT NULL CHECK (store_chain IN ('woolworths', 'coles')),
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
  FOREIGN KEY (contributor_id) REFERENCES contributors(id),
  UNIQUE (contributor_id, client_observation_id)
);

CREATE INDEX idx_v2_product_time ON observations_v2(product_id, client_observed_at);
CREATE INDEX idx_v2_contributor ON observations_v2(contributor_id);
CREATE INDEX idx_v2_chain_time ON observations_v2(store_chain, client_observed_at);
CREATE INDEX idx_v2_comparison ON observations_v2(comparison_id, capture_phase);

-- Public, non-attributable daily history retained after raw observations expire.
-- Only days meeting the five-contributor quorum are materialized.
CREATE TABLE daily_product_aggregates (
  product_id TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  store_chain TEXT NOT NULL CHECK (store_chain IN ('woolworths', 'coles')),
  median_price_cents INTEGER NOT NULL,
  min_price_cents INTEGER NOT NULL,
  max_price_cents INTEGER NOT NULL,
  observation_count INTEGER NOT NULL,
  contributor_count INTEGER NOT NULL CHECK (contributor_count >= 5),
  created_at TEXT NOT NULL,
  PRIMARY KEY (product_id, observation_date)
);

CREATE INDEX idx_daily_product_aggregates_date
  ON daily_product_aggregates(observation_date);

-- Remove any legacy raw IP rate-limit keys during migration. New keys are HMACs.
DELETE FROM rate_limits;
