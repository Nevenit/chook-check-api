import { Hono } from "hono";
import type { App } from "../lib/types";
import { createContributor } from "../lib/auth";
import { registrationRateLimit } from "../middleware/rate-limit";

const v2Contributors = new Hono<App>();

v2Contributors.post("/", registrationRateLimit, async (c) => {
  return c.json(await createContributor(c.env.DB), 201);
});

export { v2Contributors };
