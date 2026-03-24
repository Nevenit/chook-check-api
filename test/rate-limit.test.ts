import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

const validBody = {
  contributorId: "00000000-0000-0000-0000-000000000001",
  observations: [
    {
      productId: "woolworths:1",
      productName: "Test Product",
      storeChain: "woolworths",
      priceCents: 500,
      isPersonalised: false,
      observedAt: new Date().toISOString(),
    },
  ],
};

describe("rate limiting", () => {
  it("allows requests within the limit", async () => {
    const res = await SELF.fetch("http://localhost/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
  });

  it("returns 429 when POST limit exceeded", async () => {
    // Submit 61 requests (limit is 60/hour)
    for (let i = 0; i < 60; i++) {
      await SELF.fetch("http://localhost/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
    }
    const res = await SELF.fetch("http://localhost/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(429);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("rate_limited");
  });

  it("includes Retry-After header on 429", async () => {
    for (let i = 0; i < 60; i++) {
      await SELF.fetch("http://localhost/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
    }
    const res = await SELF.fetch("http://localhost/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
