import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { App } from "../lib/types";
import { trendsQuerySchema } from "../lib/schemas";
import { getTrends } from "../db/queries";
import { getRateLimit } from "../middleware/rate-limit";

const PERIOD_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

const trends = new Hono<App>();

trends.get(
  "/",
  getRateLimit,
  zValidator("query", trendsQuerySchema, (result, c) => {
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
    const { period, chain, category, limit } = c.req.valid("query");
    const periodDays = PERIOD_DAYS[period];
    const results = await getTrends(c.env.DB, periodDays, limit, chain, category);
    return c.json({ trends: results });
  },
);

export { trends };
