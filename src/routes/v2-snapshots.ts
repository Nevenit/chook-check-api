import { Hono } from "hono";
import type { App } from "../lib/types";
import { getRateLimit } from "../middleware/rate-limit";

const v2Snapshots = new Hono<App>();

v2Snapshots.get("/products", getRateLimit, async (c) => {
  const meta = await c.env.DB.prepare(
    `SELECT generation, etag FROM snapshot_meta WHERE id = 1`,
  ).first<{ generation: number; etag: string }>();
  if (!meta) return c.json({ generatedAt: null, products: [] });
  const etag = `"${meta.etag}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };
  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304, headers);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT body FROM snapshot_chunks WHERE generation = ?1 ORDER BY seq`,
  )
    .bind(meta.generation)
    .all<{ body: string }>();
  return c.body(results.map((row) => row.body).join(""), 200, {
    ...headers,
    "Content-Type": "application/json; charset=UTF-8",
  });
});

export { v2Snapshots };
