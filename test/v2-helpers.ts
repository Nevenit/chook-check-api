import { SELF } from "cloudflare:test";

export interface TestCredentials {
  contributorId: string;
  submitToken: string;
  deletionToken: string;
}

export async function registerContributor(
  ip = "203.0.113.10",
): Promise<TestCredentials> {
  const response = await SELF.fetch("http://localhost/api/v2/contributors", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
  });
  if (response.status !== 201) {
    throw new Error(`Registration failed with ${response.status}`);
  }
  return response.json<TestCredentials>();
}

export function makeV2Observation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    clientObservationId: crypto.randomUUID(),
    productId: "woolworths:123",
    productName: "Vegemite 380g",
    brand: "Vegemite",
    category: "Spreads",
    gtin: "9300650000016",
    storeChain: "woolworths",
    currentPriceCents: 750,
    regularPriceCents: null,
    unitPriceCents: 197,
    unitMeasure: "100g",
    offerType: null,
    offerTextNormalized: null,
    offerId: null,
    requiredQuantity: null,
    sourceSurface: "product_page",
    extractionSource: "json_ld",
    scraperVersion: "2.1.0",
    instrumentMode: "silent",
    capturePhase: "baseline",
    comparisonId: null,
    storeId: null,
    coarseRegion: null,
    fulfilmentMode: "unknown",
    authState: "unknown",
    loyaltyState: "unknown",
    browserFamily: null,
    clientObservedAt: new Date().toISOString(),
    ...overrides,
  };
}

export async function postV2(
  submitToken: string,
  body: unknown,
): Promise<Response> {
  return SELF.fetch("http://localhost/api/v2/observations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${submitToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
