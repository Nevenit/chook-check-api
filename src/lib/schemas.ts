import { z } from "zod";

const fourteenDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
};

export const observationSchema = z.object({
  productId: z.string().min(1).max(100),
  productName: z.string().min(1).max(200),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  gtin: z.string().max(20).nullable().optional(),
  storeChain: z.enum(["woolworths", "coles"]),
  priceCents: z.number().int().positive().lt(1_000_000),
  wasPriceCents: z
    .number()
    .int()
    .positive()
    .lt(1_000_000)
    .nullable()
    .optional(),
  unitPriceCents: z
    .number()
    .int()
    .positive()
    .lt(1_000_000)
    .nullable()
    .optional(),
  unitMeasure: z.string().max(50).nullable().optional(),
  promoType: z.string().max(50).nullable().optional(),
  isPersonalised: z.boolean(),
  observedAt: z
    .string()
    .datetime()
    .refine(
      (val) => new Date(val).getTime() >= new Date(fourteenDaysAgo()).getTime(),
      {
        message: "observedAt must be within the last 14 days",
      },
    )
    .refine((val) => new Date(val).getTime() <= Date.now(), {
      message: "observedAt must not be in the future",
    }),
});

export const submitObservationsSchema = z.object({
  contributorId: z.string().uuid(),
  observations: z.array(observationSchema).min(1).max(50),
  context: z
    .object({
      browser: z.string().max(50).optional(),
      state: z.string().max(20).optional(),
      city: z.string().max(100).optional(),
      store: z.string().max(200).optional(),
    })
    .optional(),
});

export const productStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  chain: z.enum(["woolworths", "coles"]).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
  chain: z.enum(["woolworths", "coles"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const trendsQuerySchema = z.object({
  period: z.enum(["1d", "7d", "14d", "30d"]).default("7d"),
  chain: z.enum(["woolworths", "coles"]).optional(),
  category: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const nullableShortText = (max: number) =>
  z.string().trim().max(max).nullable();
const recentClientTimestamp = z
  .string()
  .datetime()
  .refine(
    (value) =>
      Date.now() - new Date(value).getTime() <= 14 * 24 * 60 * 60 * 1000,
    "clientObservedAt must be within the last 14 days",
  )
  .refine(
    (value) => new Date(value).getTime() <= Date.now() + 5 * 60 * 1000,
    "clientObservedAt must not be in the future",
  );

export const observationV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    clientObservationId: z.string().uuid(),
    productId: z.string().min(3).max(100),
    productName: z.string().trim().min(1).max(200),
    brand: nullableShortText(100),
    category: nullableShortText(100),
    gtin: z
      .string()
      .regex(/^\d{8,14}$/)
      .nullable(),
    storeChain: z.enum(["woolworths", "coles"]),
    currentPriceCents: z.number().int().positive().lt(1_000_000),
    regularPriceCents: z.number().int().positive().lt(1_000_000).nullable(),
    unitPriceCents: z.number().int().positive().lt(1_000_000).nullable(),
    unitMeasure: nullableShortText(50),
    offerType: nullableShortText(50),
    offerTextNormalized: nullableShortText(200),
    offerId: nullableShortText(100),
    requiredQuantity: z.number().int().min(2).max(100).nullable(),
    sourceSurface: z.enum([
      "product_page",
      "search_result",
      "category_tile",
      "recommendation",
      "personalised_placement",
      "unknown",
    ]),
    extractionSource: z.enum(["json_ld", "hydration_state", "dom", "unknown"]),
    scraperVersion: z.string().trim().min(1).max(30),
    instrumentMode: z.enum(["silent", "user_activated_inline"]),
    capturePhase: z.enum(["baseline", "pre_ui", "post_ui"]),
    comparisonId: z.string().uuid().nullable(),
    storeId: nullableShortText(100),
    coarseRegion: nullableShortText(100),
    fulfilmentMode: z.enum(["delivery", "pickup", "in_store", "unknown"]),
    authState: z.enum(["guest", "signed_in", "unknown"]),
    loyaltyState: z.enum(["member_eligible", "non_member", "unknown"]),
    browserFamily: nullableShortText(30),
    clientObservedAt: recentClientTimestamp,
  })
  .strict()
  .superRefine((observation, context) => {
    if (!observation.productId.startsWith(`${observation.storeChain}:`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "productId prefix must match storeChain",
      });
    }
    if (
      observation.regularPriceCents !== null &&
      observation.regularPriceCents < observation.currentPriceCents
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regularPriceCents"],
        message: "regularPriceCents cannot be lower than currentPriceCents",
      });
    }
    if (
      observation.capturePhase === "baseline" &&
      observation.instrumentMode !== "silent"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capturePhase"],
        message: "baseline captures must use silent instrument mode",
      });
    }
    if (
      observation.capturePhase !== "baseline" &&
      (!observation.comparisonId ||
        observation.instrumentMode !== "user_activated_inline")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comparisonId"],
        message: "inline pre/post captures require a comparisonId",
      });
    }
  });

export const submitObservationsV2Schema = z
  .object({
    mode: z.enum(["history", "fairness"]),
    observations: z.array(observationV2Schema).min(1).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    request.observations.forEach((observation, index) => {
      if (request.mode === "history") {
        const containsFairnessContext =
          observation.storeId !== null ||
          observation.coarseRegion !== null ||
          observation.fulfilmentMode !== "unknown" ||
          observation.authState !== "unknown" ||
          observation.loyaltyState !== "unknown" ||
          observation.browserFamily !== null ||
          observation.instrumentMode !== "silent" ||
          observation.capturePhase !== "baseline" ||
          observation.comparisonId !== null;
        if (containsFairnessContext) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["observations", index],
            message: "history mode must not contain fairness-study context",
          });
        }
      } else if (!observation.storeId && !observation.coarseRegion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations", index],
          message: "fairness mode requires storeId or coarseRegion",
        });
      }
    });
  });
