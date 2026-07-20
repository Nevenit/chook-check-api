import { Hono } from "hono";
import type { App } from "../lib/types";
import { getDailyProductAggregates, getProductRowsV2 } from "../db/queries-v2";
import { aggregateProductV2 } from "../lib/aggregation-v2";
import { getRateLimit } from "../middleware/rate-limit";

const v2Products = new Hono<App>();

v2Products.get("/:productId/stats", getRateLimit, async (c) => {
  const productId = c.req.param("productId");
  const [rows, historical] = await Promise.all([
    getProductRowsV2(c.env.DB, productId),
    getDailyProductAggregates(c.env.DB, productId),
  ]);
  const stats = aggregateProductV2(productId, rows, historical);
  if (!stats) {
    return c.json(
      { error: "not_found", message: "No observations found for this product" },
      404,
    );
  }
  return c.json(stats);
});

export { v2Products };
