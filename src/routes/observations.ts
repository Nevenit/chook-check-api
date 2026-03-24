import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { App } from "../lib/types";
import { submitObservationsSchema } from "../lib/schemas";
import { isDuplicate, insertObservation } from "../db/queries";
import { postRateLimit } from "../middleware/rate-limit";

const observations = new Hono<App>();

observations.post(
  "/",
  zValidator("json", submitObservationsSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "validation_error",
          message: "Invalid request body",
          details: result.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        },
        400,
      );
    }
  }),
  postRateLimit,
  async (c) => {
    const { contributorId, observations: obs, context } = c.req.valid("json");
    const db = c.env.DB;

    let accepted = 0;
    let duplicates = 0;
    const rejected = 0;
    const reasons: string[] = [];

    for (const o of obs) {
      const dup = await isDuplicate(
        db,
        contributorId,
        o.productId,
        o.observedAt,
        o.priceCents,
      );
      if (dup) {
        duplicates++;
        continue;
      }

      await insertObservation(db, {
        productId: o.productId,
        productName: o.productName,
        brand: o.brand ?? null,
        category: o.category ?? null,
        gtin: o.gtin ?? null,
        storeChain: o.storeChain,
        priceCents: o.priceCents,
        wasPriceCents: o.wasPriceCents ?? null,
        unitPriceCents: o.unitPriceCents ?? null,
        unitMeasure: o.unitMeasure ?? null,
        promoType: o.promoType ?? null,
        isPersonalised: o.isPersonalised,
        contributorId,
        browser: context?.browser ?? null,
        state: context?.state ?? null,
        city: context?.city ?? null,
        storeName: context?.store ?? null,
        observedAt: o.observedAt,
      });
      accepted++;
    }

    return c.json(
      {
        accepted,
        duplicates,
        rejected,
        ...(reasons.length > 0 ? { reasons } : {}),
      },
      201,
    );
  },
);

export { observations };
