import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(async () => {
  await cleanDb();
});

describe("validation: POST /api/v2/observations", () => {
  it("rejects empty observations array", async () => {
    const credentials = await registerContributor();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects more than 50 observations", async () => {
    const credentials = await registerContributor();
    const observations = Array.from({ length: 51 }, () => makeV2Observation());
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations,
    });
    expect(res.status).toBe(400);
  });

  it("rejects negative currentPriceCents", async () => {
    const credentials = await registerContributor();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ currentPriceCents: -100 })],
    });
    expect(res.status).toBe(400);
  });

  it("rejects currentPriceCents at the $10,000 sanity cap", async () => {
    const credentials = await registerContributor();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ currentPriceCents: 1_000_000 })],
    });
    expect(res.status).toBe(400);
  });

  it("rejects clientObservedAt older than 14 days", async () => {
    const credentials = await registerContributor();
    const fifteenDaysAgo = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ clientObservedAt: fifteenDaysAgo })],
    });
    expect(res.status).toBe(400);
  });

  it("rejects clientObservedAt in the future", async () => {
    const credentials = await registerContributor();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ clientObservedAt: tomorrow })],
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid storeChain", async () => {
    const credentials = await registerContributor();
    const res = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ storeChain: "aldi" })],
    });
    expect(res.status).toBe(400);
  });
});

describe("legacy write authority", () => {
  it("retires UUID-only deletion regardless of ID shape", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/contributor/not-a-uuid",
      {
        method: "DELETE",
      },
    );
    expect(res.status).toBe(410);
  });
});
