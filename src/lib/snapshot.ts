import { hashToken } from "./crypto";

/** Characters per stored chunk; at most 1.5 MB of UTF-8, below D1's 2 MB limit. */
export const SNAPSHOT_CHUNK_CHARS = 500_000;
/** The cron trigger that publishes the snapshot (see wrangler.toml). */
export const SNAPSHOT_CRON = "*/30 * * * *";

/** Split text into chunks without separating a UTF-16 surrogate pair. */
export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    if (end === start) end = start + 2;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Publish public product stats as a new snapshot generation when its content
 * changed. The ETag hashes the product list only, so rebuilding identical
 * content does not make clients download it again.
 */
export async function buildSnapshot(
  db: D1Database,
  now = new Date(),
  chunkChars = SNAPSHOT_CHUNK_CHARS,
): Promise<{ changed: boolean; productCount: number }> {
  const { results } = await db
    .prepare(
      `SELECT stats_json FROM product_stats WHERE public = 1 ORDER BY product_id`,
    )
    .all<{ stats_json: string }>();
  const products = `[${results.map((row) => row.stats_json).join(",")}]`;
  const etag = await hashToken(products);
  const meta = await db
    .prepare(`SELECT generation, etag FROM snapshot_meta WHERE id = 1`)
    .first<{ generation: number; etag: string }>();
  if (meta?.etag === etag)
    return { changed: false, productCount: results.length };

  const generation = (meta?.generation ?? 0) + 1;
  const body = `{"generatedAt":${JSON.stringify(now.toISOString())},"products":${products}}`;
  for (const [seq, chunk] of chunkText(body, chunkChars).entries()) {
    await db
      .prepare(
        `INSERT INTO snapshot_chunks (generation, seq, body) VALUES (?1, ?2, ?3)`,
      )
      .bind(generation, seq, chunk)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO snapshot_meta (id, generation, etag, generated_at, product_count)
       VALUES (1, ?1, ?2, ?3, ?4)
       ON CONFLICT (id) DO UPDATE SET
         generation = excluded.generation, etag = excluded.etag,
         generated_at = excluded.generated_at, product_count = excluded.product_count`,
    )
    .bind(generation, etag, now.toISOString(), results.length)
    .run();
  // Keep the previous generation for requests that read meta before the switch.
  await db
    .prepare(`DELETE FROM snapshot_chunks WHERE generation < ?1`)
    .bind(generation - 1)
    .run();
  return { changed: true, productCount: results.length };
}
