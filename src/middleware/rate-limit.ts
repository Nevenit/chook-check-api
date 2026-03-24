import { createMiddleware } from "hono/factory";
import type { App } from "../lib/types";

interface RateLimitConfig {
  limit: number;
  windowMs: number;
  keyFn: (c: any) => string | null;
}

export function rateLimit(config: RateLimitConfig) {
  return createMiddleware<App>(async (c, next) => {
    const key = config.keyFn(c);
    if (!key) {
      return next();
    }

    const db = c.env.DB;
    const endpoint = `${c.req.method} ${c.req.routePath}`;
    const now = Date.now();

    const row = await db
      .prepare(
        `SELECT count, window_start FROM rate_limits WHERE key = ? AND endpoint = ?`,
      )
      .bind(key, endpoint)
      .first<{ count: number; window_start: string }>();

    if (!row) {
      await db
        .prepare(
          `INSERT INTO rate_limits (key, endpoint, count, window_start) VALUES (?, ?, 1, ?)`,
        )
        .bind(key, endpoint, new Date(now).toISOString())
        .run();
      return next();
    }

    const windowStart = new Date(row.window_start).getTime();
    const windowAge = now - windowStart;

    if (windowAge > config.windowMs) {
      await db
        .prepare(
          `UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ? AND endpoint = ?`,
        )
        .bind(new Date(now).toISOString(), key, endpoint)
        .run();
      return next();
    }

    if (row.count >= config.limit) {
      const retryAfter = Math.ceil((config.windowMs - windowAge) / 1000);
      return c.json(
        {
          error: "rate_limited",
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    await db
      .prepare(
        `UPDATE rate_limits SET count = count + 1 WHERE key = ? AND endpoint = ?`,
      )
      .bind(key, endpoint)
      .run();

    return next();
  });
}

// Pre-configured rate limiters
const ONE_HOUR = 60 * 60 * 1000;

/** 60 requests/hour keyed by contributor ID from validated JSON body. */
export const postRateLimit = rateLimit({
  limit: 60,
  windowMs: ONE_HOUR,
  keyFn: (c) => {
    try {
      const data = c.req.valid("json");
      return data?.contributorId ?? null;
    } catch {
      return null;
    }
  },
});

/** 120 requests/hour keyed by IP for GET endpoints. */
export const getRateLimit = rateLimit({
  limit: 120,
  windowMs: ONE_HOUR,
  keyFn: (c) =>
    c.req.header("CF-Connecting-IP") ??
    c.req.header("x-forwarded-for") ??
    "unknown",
});

/** 5 requests/hour keyed by contributor ID in URL param. */
export const deleteRateLimit = rateLimit({
  limit: 5,
  windowMs: ONE_HOUR,
  keyFn: (c) => c.req.param("contributorId") ?? null,
});
