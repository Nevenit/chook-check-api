import type { DayBucket } from "../lib/types";
import { median, promoFrequency, trendChange } from "../lib/aggregation";

// --- Observations ---

export interface InsertObservation {
  productId: string;
  productName: string;
  brand: string | null;
  category: string | null;
  gtin: string | null;
  storeChain: string;
  priceCents: number;
  wasPriceCents: number | null;
  unitPriceCents: number | null;
  unitMeasure: string | null;
  promoType: string | null;
  isPersonalised: boolean;
  contributorId: string;
  browser: string | null;
  state: string | null;
  city: string | null;
  storeName: string | null;
  observedAt: string;
}

/** Check if a duplicate observation exists (same contributor, product, UTC day, price). */
export async function isDuplicate(
  db: D1Database,
  contributorId: string,
  productId: string,
  observedAt: string,
  priceCents: number,
): Promise<boolean> {
  const utcDate = observedAt.slice(0, 10); // "YYYY-MM-DD"
  const result = await db
    .prepare(
      `SELECT 1 FROM observations
       WHERE contributor_id = ? AND product_id = ?
         AND substr(observed_at, 1, 10) = ? AND price_cents = ?
       LIMIT 1`,
    )
    .bind(contributorId, productId, utcDate, priceCents)
    .first();
  return result !== null;
}

/** Insert a single observation. */
export async function insertObservation(
  db: D1Database,
  obs: InsertObservation,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO observations (
        product_id, product_name, brand, category, gtin, store_chain,
        price_cents, was_price_cents, unit_price_cents, unit_measure,
        promo_type, is_personalised, contributor_id,
        browser, state, city, store_name, observed_at, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      obs.productId,
      obs.productName,
      obs.brand,
      obs.category,
      obs.gtin,
      obs.storeChain,
      obs.priceCents,
      obs.wasPriceCents,
      obs.unitPriceCents,
      obs.unitMeasure,
      obs.promoType,
      obs.isPersonalised ? 1 : 0,
      obs.contributorId,
      obs.browser,
      obs.state,
      obs.city,
      obs.storeName,
      obs.observedAt,
      new Date().toISOString(),
    )
    .run();
}

// --- Product Stats ---

const QUORUM = 3;

interface ObservationRow {
  price_cents: number;
  promo_type: string | null;
  observed_at: string;
  contributor_id: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
}

/** Get product stats with crowd quorum enforcement. */
export async function getProductStats(
  db: D1Database,
  productId: string,
  days: number,
  chain?: string,
) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  let sql = `SELECT price_cents, promo_type, observed_at, contributor_id,
                    product_name, brand, store_chain
             FROM observations
             WHERE product_id = ? AND observed_at >= ?`;
  const params: unknown[] = [productId, sinceStr];

  if (chain) {
    sql += ` AND store_chain = ?`;
    params.push(chain);
  }

  sql += ` ORDER BY observed_at ASC`;

  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<ObservationRow>();

  if (!results || results.length === 0) return null;

  const contributors = new Set(results.map((r) => r.contributor_id));
  const quorum = contributors.size >= QUORUM;

  const prices = results.map((r) => r.price_cents);
  const latestRow = results[results.length - 1];

  // Group by UTC date for price history
  const byDate = new Map<string, number[]>();
  for (const row of results) {
    const date = row.observed_at.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row.price_cents);
  }

  const priceHistory: DayBucket[] = [];
  for (const [date, dayPrices] of byDate) {
    priceHistory.push({
      date,
      medianCents: median(dayPrices),
      minCents: Math.min(...dayPrices),
      maxCents: Math.max(...dayPrices),
    });
  }

  return {
    productId,
    productName: latestRow.product_name,
    brand: latestRow.brand,
    storeChain: latestRow.store_chain,
    quorum,
    currentMedianCents: quorum ? median(prices) : null,
    minCents: quorum ? Math.min(...prices) : null,
    maxCents: quorum ? Math.max(...prices) : null,
    observationCount: results.length,
    contributorCount: contributors.size,
    priceHistory: quorum ? priceHistory : [],
    promoFrequency: quorum
      ? promoFrequency(results.map((r) => r.promo_type))
      : {},
  };
}

// --- Search ---

interface SearchRow {
  product_id: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
  cnt: number;
  contributor_cnt: number;
}

export async function searchProducts(
  db: D1Database,
  query: string,
  limit: number,
  chain?: string,
) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString();
  const likeTerm = `%${query}%`;

  let sql = `SELECT product_id, product_name, brand, store_chain,
                    COUNT(*) as cnt,
                    COUNT(DISTINCT contributor_id) as contributor_cnt
             FROM observations
             WHERE observed_at >= ?
               AND (product_name LIKE ? OR brand LIKE ?)`;
  const params: unknown[] = [sinceStr, likeTerm, likeTerm];

  if (chain) {
    sql += ` AND store_chain = ?`;
    params.push(chain);
  }

  sql += ` GROUP BY product_id
           HAVING contributor_cnt >= ?
           ORDER BY cnt DESC
           LIMIT ?`;
  params.push(QUORUM, limit);

  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<SearchRow>();

  if (!results) return [];

  // Compute median for each product
  const searchResults = [];
  for (const row of results) {
    const priceRows = await db
      .prepare(
        `SELECT price_cents FROM observations
         WHERE product_id = ? AND observed_at >= ?`,
      )
      .bind(row.product_id, sinceStr)
      .all<{ price_cents: number }>();

    searchResults.push({
      productId: row.product_id,
      productName: row.product_name,
      brand: row.brand,
      storeChain: row.store_chain,
      latestMedianCents: median(
        (priceRows.results ?? []).map((r) => r.price_cents),
      ),
      observationCount: row.cnt,
    });
  }

  return searchResults;
}

// --- Trends ---

interface TrendRow {
  product_id: string;
  product_name: string;
  brand: string | null;
  store_chain: string;
}

export async function getTrends(
  db: D1Database,
  periodDays: number,
  limit: number,
  chain?: string,
  category?: string,
) {
  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - periodDays);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - periodDays);

  const currentStartStr = currentStart.toISOString();
  const previousStartStr = previousStart.toISOString();
  const nowStr = now.toISOString();

  // Get all products with observations in the full window
  let sql = `SELECT DISTINCT product_id, product_name, brand, store_chain
             FROM observations
             WHERE observed_at >= ?`;
  const params: unknown[] = [previousStartStr];

  if (chain) {
    sql += ` AND store_chain = ?`;
    params.push(chain);
  }
  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }

  const { results: products } = await db
    .prepare(sql)
    .bind(...params)
    .all<TrendRow>();

  if (!products || products.length === 0) return [];

  const trends = [];

  for (const product of products) {
    // Current period observations
    const currentObs = await db
      .prepare(
        `SELECT price_cents, contributor_id FROM observations
         WHERE product_id = ? AND observed_at >= ? AND observed_at <= ?`,
      )
      .bind(product.product_id, currentStartStr, nowStr)
      .all<{ price_cents: number; contributor_id: string }>();

    // Previous period observations
    const prevObs = await db
      .prepare(
        `SELECT price_cents, contributor_id FROM observations
         WHERE product_id = ? AND observed_at >= ? AND observed_at < ?`,
      )
      .bind(product.product_id, previousStartStr, currentStartStr)
      .all<{ price_cents: number; contributor_id: string }>();

    const currentResults = currentObs.results ?? [];
    const prevResults = prevObs.results ?? [];

    // Check quorum in both periods
    const currentContributors = new Set(
      currentResults.map((r) => r.contributor_id),
    );
    const prevContributors = new Set(prevResults.map((r) => r.contributor_id));

    if (currentContributors.size < QUORUM || prevContributors.size < QUORUM) {
      continue;
    }

    if (currentResults.length === 0 || prevResults.length === 0) continue;

    const currentMedian = median(currentResults.map((r) => r.price_cents));
    const prevMedian = median(prevResults.map((r) => r.price_cents));

    if (currentMedian === prevMedian) continue;

    const change = trendChange(currentMedian, prevMedian);

    trends.push({
      productId: product.product_id,
      productName: product.product_name,
      brand: product.brand,
      storeChain: product.store_chain,
      changePercent: Math.round(change.changePercent * 100) / 100,
      direction: change.direction,
      currentMedianCents: currentMedian,
      previousMedianCents: prevMedian,
    });
  }

  // Sort by absolute change, take top N
  trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return trends.slice(0, limit);
}

// --- Contributor Deletion ---

export async function deleteContributor(
  db: D1Database,
  contributorId: string,
): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM observations WHERE contributor_id = ?`)
    .bind(contributorId)
    .run();
  return result.meta?.changes ?? 0;
}
