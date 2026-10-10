import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { App } from "../lib/types";
import { authenticateContributor } from "../lib/auth";
import { submitObservationsV2Schema } from "../lib/schemas";
import { submitObservationsV2 } from "../lib/ingest";
import { authenticatedSubmitRateLimit } from "../middleware/rate-limit";

const v2Observations = new Hono<App>();

v2Observations.post(
  "/",
  authenticatedSubmitRateLimit,
  zValidator("json", submitObservationsV2Schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation_error",
          message: "Invalid v2 observation request",
          details: result.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        },
        400,
      );
    }
  }),
  async (c) => {
    const contributorId = await authenticateContributor(c, "submit");
    if (!contributorId) {
      return c.json(
        { error: "unauthorized", message: "A valid submit token is required" },
        401,
      );
    }
    const request = c.req.valid("json");
    const { accepted, duplicates, rejected, reasons } =
      await submitObservationsV2(
        c.env.DB,
        contributorId,
        request.mode,
        request.observations,
      );
    return c.json(
      {
        accepted,
        duplicates,
        rejected,
        ...(reasons.length ? { reasons } : {}),
      },
      201,
    );
  },
);

export { v2Observations };
