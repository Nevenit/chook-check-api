import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(async () => {
  await cleanDb();
});

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    contributorId: "00000000-0000-0000-0000-000000000001",
    observations: [
      {
        productId: "woolworths:123",
        productName: "Vegemite 380g",
        brand: "Vegemite",
        category: "Spreads",
        storeChain: "woolworths",
        priceCents: 750,
        isPersonalised: false,
        observedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

async function postObs(body: unknown) {
  return SELF.fetch("http://localhost/api/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/observations", () => {
  it("accepts a valid single observation", async () => {
    const res = await postObs(makeBody());
    expect(res.status).toBe(201);
    const json = await res.json<{ accepted: number; duplicates: number }>();
    expect(json.accepted).toBe(1);
    expect(json.duplicates).toBe(0);
  });

  it("accepts a batch of observations", async () => {
    const body = makeBody({
      observations: [
        {
          productId: "woolworths:1",
          productName: "Product A",
          storeChain: "woolworths",
          priceCents: 500,
          isPersonalised: false,
          observedAt: new Date().toISOString(),
        },
        {
          productId: "woolworths:2",
          productName: "Product B",
          storeChain: "coles",
          priceCents: 600,
          isPersonalised: false,
          observedAt: new Date().toISOString(),
        },
      ],
    });
    const res = await postObs(body);
    expect(res.status).toBe(201);
    const json = await res.json<{ accepted: number }>();
    expect(json.accepted).toBe(2);
  });

  it("deduplicates same contributor + product + day + price", async () => {
    const body = makeBody();
    await postObs(body);
    const res = await postObs(body);
    expect(res.status).toBe(201);
    const json = await res.json<{ accepted: number; duplicates: number }>();
    expect(json.accepted).toBe(0);
    expect(json.duplicates).toBe(1);
  });

  it("rejects invalid contributorId", async () => {
    const res = await postObs(makeBody({ contributorId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    const json = await res.json<{ error: string }>();
    expect(json.error).toBe("validation_error");
  });

  it("rejects empty observations array", async () => {
    const res = await postObs(makeBody({ observations: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects negative price", async () => {
    const body = makeBody({
      observations: [
        {
          productId: "woolworths:1",
          productName: "Test",
          storeChain: "woolworths",
          priceCents: -100,
          isPersonalised: false,
          observedAt: new Date().toISOString(),
        },
      ],
    });
    const res = await postObs(body);
    expect(res.status).toBe(400);
  });

  it("rejects observations older than 14 days", async () => {
    const old = new Date();
    old.setDate(old.getDate() - 15);
    const body = makeBody({
      observations: [
        {
          productId: "woolworths:1",
          productName: "Test",
          storeChain: "woolworths",
          priceCents: 500,
          isPersonalised: false,
          observedAt: old.toISOString(),
        },
      ],
    });
    const res = await postObs(body);
    expect(res.status).toBe(400);
  });

  it("stores context fields when provided", async () => {
    const body = makeBody({
      context: { browser: "Chrome", state: "VIC" },
    });
    const res = await postObs(body);
    expect(res.status).toBe(201);

    // Verify in DB
    const row = await env.DB.prepare(
      "SELECT browser, state FROM observations LIMIT 1",
    ).first<{ browser: string; state: string }>();
    expect(row?.browser).toBe("Chrome");
    expect(row?.state).toBe("VIC");
  });
});
