import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { App } from "../lib/types";
import { authenticateContributor } from "../lib/auth";
import { submitObservationsV2Schema } from "../lib/schemas";
import {
  insertObservationV2,
  isDuplicateV2,
  shouldQuarantineV2,
} from "../db/queries-v2";
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
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const reasons: string[] = [];

    for (const observation of request.observations) {
      if (
        await isDuplicateV2(
          c.env.DB,
          contributorId,
          observation.clientObservationId,
        )
      ) {
        duplicates++;
        continue;
      }
      const quarantineReason = await shouldQuarantineV2(c.env.DB, observation);
      await insertObservationV2(
        c.env.DB,
        contributorId,
        request.mode,
        observation,
        quarantineReason,
      );
      if (quarantineReason) {
        rejected++;
        reasons.push(`${observation.clientObservationId}: quarantined`);
      } else {
        accepted++;
      }
    }
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
