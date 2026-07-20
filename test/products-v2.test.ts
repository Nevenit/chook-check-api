import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(cleanDb);

async function seedHistoryContributors(
  count: number,
  productId = "woolworths:123",
) {
  for (let index = 0; index < count; index++) {
    const credentials = await registerContributor(`203.0.113.${index + 1}`);
    const response = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [
        makeV2Observation({
          productId,
          currentPriceCents: 700 + index * 10,
        }),
      ],
    });
    expect(response.status).toBe(201);
  }
}

describe("v2 product aggregates and snapshots", () => {
  it("uses a five-contributor public threshold", async () => {
    await seedHistoryContributors(4);
    let response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.1" } },
    );
    expect((await response.json<{ quorum: boolean }>()).quorum).toBe(false);

    await seedHistoryContributors(1, "woolworths:123");
    response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.1" } },
    );
    expect((await response.json<{ quorum: boolean }>()).quorum).toBe(true);
  });

  it("publishes the latest day median rather than a multi-day median", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (let index = 0; index < 5; index++) {
      const credentials = await registerContributor(`203.0.113.${index + 1}`);
      await postV2(credentials.submitToken, {
        mode: "history",
        observations: [
          makeV2Observation({
            clientObservedAt: yesterday,
            currentPriceCents: 100,
          }),
          makeV2Observation({ currentPriceCents: 500 + index * 10 }),
        ],
      });
    }
    const response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.2" } },
    );
    const stats = await response.json<{
      currentMedianCents: number;
      priceHistory: unknown[];
    }>();
    expect(stats.currentMedianCents).toBe(520);
    expect(stats.priceHistory).toHaveLength(2);
  });

  it("bulk snapshot omits products below quorum and supports ETag revalidation", async () => {
    await seedHistoryContributors(4);
    let response = await SELF.fetch(
      "http://localhost/api/v2/snapshots/products",
      { headers: { "CF-Connecting-IP": "198.51.100.3" } },
    );
    expect((await response.json<{ products: unknown[] }>()).products).toEqual(
      [],
    );

    await seedHistoryContributors(1);
    response = await SELF.fetch("http://localhost/api/v2/snapshots/products", {
      headers: { "CF-Connecting-IP": "198.51.100.3" },
    });
    const etag = response.headers.get("ETag");
    expect(etag).toBeTruthy();
    expect(
      (await response.json<{ products: unknown[] }>()).products,
    ).toHaveLength(1);

    const revalidated = await SELF.fetch(
      "http://localhost/api/v2/snapshots/products",
      {
        headers: {
          "CF-Connecting-IP": "198.51.100.3",
          "If-None-Match": etag!,
        },
      },
    );
    expect(revalidated.status).toBe(304);
  });

  it("labels persistent differences only after strict matched thresholds", async () => {
    const firstHour = new Date(Date.now() - 2 * 60 * 60 * 1000);
    firstHour.setMinutes(5, 0, 0);
    const secondHour = new Date(Date.now() - 60 * 60 * 1000);
    secondHour.setMinutes(5, 0, 0);

    for (let index = 0; index < 10; index++) {
      const credentials = await registerContributor(`203.0.113.${index + 1}`);
      const price = index < 5 ? 500 : 600;
      await postV2(credentials.submitToken, {
        mode: "fairness",
        observations: [
          makeV2Observation({
            currentPriceCents: price,
            coarseRegion: "QLD",
            fulfilmentMode: "pickup",
            clientObservedAt: firstHour.toISOString(),
          }),
          makeV2Observation({
            currentPriceCents: price,
            coarseRegion: "QLD",
            fulfilmentMode: "pickup",
            clientObservedAt: secondHour.toISOString(),
          }),
        ],
      });
    }

    const response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.4" } },
    );
    const stats = await response.json<{
      differentialSignal: { classification: string; confidence: string };
    }>();
    expect(stats.differentialSignal).toMatchObject({
      classification: "possible_differential_pricing",
      confidence: "moderate",
    });
  });

  it("keeps inline observer-effect pairs separate and thresholded", async () => {
    for (let index = 0; index < 5; index++) {
      const credentials = await registerContributor(`203.0.113.${index + 1}`);
      const comparisonId = crypto.randomUUID();
      await postV2(credentials.submitToken, {
        mode: "fairness",
        observations: [
          makeV2Observation({
            coarseRegion: "QLD",
            instrumentMode: "user_activated_inline",
            capturePhase: "pre_ui",
            comparisonId,
            currentPriceCents: 500,
          }),
          makeV2Observation({
            coarseRegion: "QLD",
            instrumentMode: "user_activated_inline",
            capturePhase: "post_ui",
            comparisonId,
            currentPriceCents: 550,
          }),
        ],
      });
    }
    const response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.5" } },
    );
    const stats = await response.json<{
      observerEffect: { contributorCount: number; changedCount: number };
    }>();
    expect(stats.observerEffect).toMatchObject({
      contributorCount: 5,
      changedCount: 5,
    });
  });
});
