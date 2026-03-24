-- Observations table
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  gtin TEXT,
  store_chain TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  was_price_cents INTEGER,
  unit_price_cents INTEGER,
  unit_measure TEXT,
  promo_type TEXT,
  is_personalised INTEGER NOT NULL DEFAULT 0,
  contributor_id TEXT NOT NULL,
  browser TEXT,
  state TEXT,
  city TEXT,
  store_name TEXT,
  observed_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX idx_observations_product_id ON observations(product_id);
CREATE INDEX idx_observations_contributor_id ON observations(contributor_id);
CREATE INDEX idx_observations_store_chain ON observations(store_chain);
CREATE INDEX idx_observations_observed_at ON observations(observed_at);
CREATE INDEX idx_observations_product_observed ON observations(product_id, observed_at);

-- Rate limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  PRIMARY KEY (key, endpoint)
);
