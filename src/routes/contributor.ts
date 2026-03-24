import { Hono } from "hono";
import type { App } from "../lib/types";
import { deleteContributor } from "../db/queries";
import { deleteRateLimit } from "../middleware/rate-limit";

const contributor = new Hono<App>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

contributor.delete("/:contributorId", deleteRateLimit, async (c) => {
  const contributorId = c.req.param("contributorId");
  if (!UUID_RE.test(contributorId)) {
    return c.json(
      { error: "validation_error", message: "contributorId must be a valid UUID" },
      400,
    );
  }
  const deleted = await deleteContributor(c.env.DB, contributorId);
  return c.json({ deleted });
});

export { contributor };
