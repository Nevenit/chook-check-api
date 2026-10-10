import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { refreshProductStats } from "../src/lib/product-stats";
import { buildSnapshot } from "../src/lib/snapshot";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(cleanDb);

// Stats refresh at most once a day per product.
const NEXT_DAY = 25 * 60 * 60 * 1000;

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

/** Run the scheduled jobs that publish stats, as if `msLater` had passed. */
async function publish(msLater = 0) {
  await refreshProductStats(env.DB, new Date(Date.now() + msLater));
  await buildSnapshot(env.DB);
}

describe("v2 product aggregates and snapshots", () => {
  it("uses a five-contributor public threshold", async () => {
    await seedHistoryContributors(4);
    await publish();
    let response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.1" } },
    );
    expect(response.status).toBe(404);

    await seedHistoryContributors(1, "woolworths:123");
    await publish(NEXT_DAY);
    response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.1" } },
    );
    expect(response.status).toBe(200);
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
    await publish();
    const response = await SELF.fetch(
      "http://localhost/api/v2/products/woolworths%3A123/stats",
      { headers: { "CF-Connecting-IP": "198.51.100.2" } },
    );
    const stats = await response.json<{ currentMedianCents: number }>();
    expect(stats.currentMedianCents).toBe(520);
  });

  it("bulk snapshot omits products below quorum and supports ETag revalidation", async () => {
    await seedHistoryContributors(4);
    await publish();
    let response = await SELF.fetch(
      "http://localhost/api/v2/snapshots/products",
      { headers: { "CF-Connecting-IP": "198.51.100.3" } },
    );
    expect((await response.json<{ products: unknown[] }>()).products).toEqual(
      [],
    );

    await seedHistoryContributors(1);
    await publish(NEXT_DAY);
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
});
