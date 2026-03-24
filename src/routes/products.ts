import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { App } from "../lib/types";
import { productStatsQuerySchema, searchQuerySchema } from "../lib/schemas";
import { getProductStats, searchProducts } from "../db/queries";
import { getRateLimit } from "../middleware/rate-limit";

const products = new Hono<App>();

products.get(
  "/:productId/stats",
  getRateLimit,
  zValidator("query", productStatsQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation_error",
          message: "Invalid query parameters",
          details: result.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        },
        400,
      );
    }
  }),
  async (c) => {
    const productId = c.req.param("productId");
    const { days, chain } = c.req.valid("query");
    const stats = await getProductStats(c.env.DB, productId, days, chain);
    if (!stats) {
      return c.json(
        {
          error: "not_found",
          message: "No observations found for this product",
        },
        404,
      );
    }
    return c.json(stats);
  },
);

products.get(
  "/search",
  getRateLimit,
  zValidator("query", searchQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation_error",
          message: "Invalid query parameters",
          details: result.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        },
        400,
      );
    }
  }),
  async (c) => {
    const { q, chain, limit } = c.req.valid("query");
    const results = await searchProducts(c.env.DB, q, limit, chain);
    return c.json({ results });
  },
);

export { products };
