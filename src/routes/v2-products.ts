import { Hono } from "hono";
import type { App } from "../lib/types";
import { getRateLimit } from "../middleware/rate-limit";

const v2Products = new Hono<App>();

v2Products.get("/:productId/stats", getRateLimit, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT stats_json FROM product_stats WHERE product_id = ?1 AND public = 1`,
  )
    .bind(c.req.param("productId"))
    .first<{ stats_json: string }>();
  if (!row) {
    return c.json(
      { error: "not_found", message: "No public stats for this product" },
      404,
    );
  }
  return c.body(row.stats_json, 200, {
    "Content-Type": "application/json; charset=UTF-8",
  });
});

export { v2Products };
