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
  wasPriceCents: z.number().int().positive().lt(1_000_000).nullable().optional(),
  unitPriceCents: z.number().int().positive().lt(1_000_000).nullable().optional(),
  unitMeasure: z.string().max(50).nullable().optional(),
  promoType: z.string().max(50).nullable().optional(),
  isPersonalised: z.boolean(),
  observedAt: z
    .string()
    .datetime()
    .refine((val) => new Date(val).getTime() >= new Date(fourteenDaysAgo()).getTime(), {
      message: "observedAt must be within the last 14 days",
    })
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
