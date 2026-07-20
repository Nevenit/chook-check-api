import { Hono } from "hono";
import type { App, ProductStats } from "../lib/types";
import {
  getDailyProductAggregates,
  getProductRowsV2,
  listPublicProductIdsV2,
} from "../db/queries-v2";
import { aggregateProductV2 } from "../lib/aggregation-v2";
import { hashToken } from "../lib/crypto";
import { getRateLimit } from "../middleware/rate-limit";

const v2Snapshots = new Hono<App>();

v2Snapshots.get("/products", getRateLimit, async (c) => {
  const productIds = await listPublicProductIdsV2(c.env.DB);
  const products: ProductStats[] = [];
  for (const productId of productIds) {
    const [rows, historical] = await Promise.all([
      getProductRowsV2(c.env.DB, productId),
      getDailyProductAggregates(c.env.DB, productId),
    ]);
    const stats = aggregateProductV2(productId, rows, historical);
    if (stats?.quorum) products.push(stats);
  }
  const [rawVersion, aggregateVersion] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count, MAX(submitted_at) AS latest
         FROM observations_v2 WHERE quarantined = 0`,
    ).first<{ count: number; latest: string | null }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count, MAX(created_at) AS latest
         FROM daily_product_aggregates`,
    ).first<{ count: number; latest: string | null }>(),
  ]);
  const version = [
    rawVersion?.count ?? 0,
    rawVersion?.latest ?? "",
    aggregateVersion?.count ?? 0,
    aggregateVersion?.latest ?? "",
  ].join(":");
  const etag = `"${await hashToken(version)}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };
  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304, headers);
  }
  return c.json(
    { generatedAt: new Date().toISOString(), products },
    200,
    headers,
  );
});

export { v2Snapshots };
