import { Hono } from "hono";
import type { App } from "../lib/types";
import { authenticateContributor } from "../lib/auth";
import { deleteContributorV2 } from "../db/queries-v2";
import { authenticatedDeleteRateLimit } from "../middleware/rate-limit";

const v2Contributor = new Hono<App>();

v2Contributor.delete("/", authenticatedDeleteRateLimit, async (c) => {
  const contributorId = await authenticateContributor(c, "deletion");
  if (!contributorId) {
    return c.json(
      { error: "unauthorized", message: "A valid deletion token is required" },
      401,
    );
  }
  return c.json({
    deleted: await deleteContributorV2(c.env.DB, contributorId),
  });
});

export { v2Contributor };
