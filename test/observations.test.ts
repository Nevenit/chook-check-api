import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(cleanDb);

describe("POST /api/v2/observations", () => {
  it("requires a server-issued submit token", async () => {
    const response = await SELF.fetch("http://localhost/api/v2/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "history",
        observations: [makeV2Observation()],
      }),
    });
    expect(response.status).toBe(401);
  });

  it("accepts a valid authenticated history observation", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
  });

  it("deduplicates client observation IDs per authenticated contributor", async () => {
    const credentials = await registerContributor();
    const observation = makeV2Observation();
    const request = { mode: "history", observations: [observation] };
    await postV2(credentials.submitToken, request);
    const response = await postV2(credentials.submitToken, request);
    expect(await response.json()).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("rejects product IDs whose prefix does not match the chain", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [
        makeV2Observation({ productId: "woolworths:123", storeChain: "coles" }),
      ],
    });
    expect(response.status).toBe(400);
  });

  it("rejects page URLs and other undeclared fields", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [
        makeV2Observation({ pageUrl: "https://example.test/private" }),
      ],
    });
    expect(response.status).toBe(400);
  });

  it("rejects fairness context in history-only mode", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation({ coarseRegion: "QLD" })],
    });
    expect(response.status).toBe(400);
  });

  it("requires store or coarse region context for fairness observations", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "fairness",
      observations: [makeV2Observation()],
    });
    expect(response.status).toBe(400);
  });

  it("stores selected fairness context without account identifiers", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.submitToken, {
      mode: "fairness",
      observations: [
        makeV2Observation({
          coarseRegion: "QLD/Brisbane",
          fulfilmentMode: "pickup",
          authState: "signed_in",
          loyaltyState: "member_eligible",
          browserFamily: "Firefox",
        }),
      ],
    });
    expect(response.status).toBe(201);
    const row = await env.DB.prepare(
      `SELECT coarse_region, fulfilment_mode, auth_state, loyalty_state,
              browser_family FROM observations_v2 LIMIT 1`,
    ).first<Record<string, string>>();
    expect(row).toMatchObject({
      coarse_region: "QLD/Brisbane",
      fulfilment_mode: "pickup",
      auth_state: "signed_in",
      loyalty_state: "member_eligible",
      browser_family: "Firefox",
    });
  });

  it("stores token hashes rather than raw submit or deletion tokens", async () => {
    const credentials = await registerContributor();
    const row = await env.DB.prepare(
      `SELECT submit_token_hash, deletion_token_hash FROM contributors WHERE id = ?`,
    )
      .bind(credentials.contributorId)
      .first<{ submit_token_hash: string; deletion_token_hash: string }>();
    expect(row?.submit_token_hash).not.toBe(credentials.submitToken);
    expect(row?.deletion_token_hash).not.toBe(credentials.deletionToken);
    expect(row?.submit_token_hash).toHaveLength(64);
  });

  it("returns 410 for the unauthenticated v1 write endpoint", async () => {
    const response = await SELF.fetch("http://localhost/api/observations", {
      method: "POST",
    });
    expect(response.status).toBe(410);
  });
});
