import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

const baseObservation = {
  productId: "woolworths:1",
  productName: "Test Product",
  storeChain: "woolworths" as const,
  priceCents: 500,
  isPersonalised: false,
  observedAt: new Date().toISOString(),
};

const validBody = {
  contributorId: "00000000-0000-0000-0000-000000000001",
  observations: [baseObservation],
};

async function postObservations(body: unknown) {
  return SELF.fetch("http://localhost/api/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validation: POST /api/observations", () => {
  it("rejects invalid contributorId UUID", async () => {
    const res = await postObservations({
      ...validBody,
      contributorId: "not-a-uuid",
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("validation_error");
  });

  it("rejects empty observations array", async () => {
    const res = await postObservations({ ...validBody, observations: [] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 50 observations", async () => {
    const obs = Array.from({ length: 51 }, () => baseObservation);
    const res = await postObservations({ ...validBody, observations: obs });
    expect(res.status).toBe(400);
  });

  it("rejects negative priceCents", async () => {
    const res = await postObservations({
      ...validBody,
      observations: [{ ...baseObservation, priceCents: -100 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects priceCents at the $10,000 sanity cap", async () => {
    const res = await postObservations({
      ...validBody,
      observations: [{ ...baseObservation, priceCents: 1_000_000 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects observedAt older than 14 days", async () => {
    const fifteenDaysAgo = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await postObservations({
      ...validBody,
      observations: [{ ...baseObservation, observedAt: fifteenDaysAgo }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects observedAt in the future", async () => {
    const tomorrow = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await postObservations({
      ...validBody,
      observations: [{ ...baseObservation, observedAt: tomorrow }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid storeChain", async () => {
    const res = await postObservations({
      ...validBody,
      observations: [{ ...baseObservation, storeChain: "aldi" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("validation: GET /api/products/search", () => {
  it("rejects q shorter than 2 characters", async () => {
    const res = await SELF.fetch("http://localhost/api/products/search?q=a");
    expect(res.status).toBe(400);
  });

  it("rejects q longer than 100 characters", async () => {
    const q = "a".repeat(101);
    const res = await SELF.fetch(
      `http://localhost/api/products/search?q=${q}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid chain", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/products/search?q=test&chain=aldi",
    );
    expect(res.status).toBe(400);
  });
});

describe("validation: GET /api/products/:id/stats", () => {
  it("rejects days < 1", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:1/stats?days=0",
    );
    expect(res.status).toBe(400);
  });

  it("rejects days > 90", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/products/woolworths:1/stats?days=100",
    );
    expect(res.status).toBe(400);
  });
});

describe("validation: GET /api/trends", () => {
  it("rejects invalid period", async () => {
    const res = await SELF.fetch("http://localhost/api/trends?period=99d");
    expect(res.status).toBe(400);
  });

  it("rejects limit > 50", async () => {
    const res = await SELF.fetch("http://localhost/api/trends?limit=100");
    expect(res.status).toBe(400);
  });
});

describe("validation: DELETE /api/contributor/:id", () => {
  it("rejects non-UUID contributor ID", async () => {
    const res = await SELF.fetch("http://localhost/api/contributor/not-a-uuid", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });
});
