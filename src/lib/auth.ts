import type { Context } from "hono";
import type { App, ContributorCredentials } from "./types";
import { hashToken, randomToken } from "./crypto";

type TokenKind = "submit" | "deletion";

export async function createContributor(
  db: D1Database,
): Promise<ContributorCredentials> {
  const contributorId = crypto.randomUUID();
  const submitToken = randomToken();
  const deletionToken = randomToken();
  await db
    .prepare(
      `INSERT INTO contributors
       (id, submit_token_hash, deletion_token_hash, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`,
    )
    .bind(
      contributorId,
      await hashToken(submitToken),
      await hashToken(deletionToken),
      new Date().toISOString(),
    )
    .run();
  return { contributorId, submitToken, deletionToken };
}

function getBearerToken(c: Context<App>): string | null {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function authenticateContributor(
  c: Context<App>,
  kind: TokenKind,
): Promise<string | null> {
  const token = getBearerToken(c);
  if (!token) return null;
  const column =
    kind === "submit" ? "submit_token_hash" : "deletion_token_hash";
  const row = await c.env.DB.prepare(
    `SELECT id FROM contributors WHERE ${column} = ? AND status = 'active'`,
  )
    .bind(await hashToken(token))
    .first<{ id: string }>();
  return row?.id ?? null;
}
