import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(cleanDb);

describe("rate limiting", () => {
  it("limits contributor registration per HMAC-pseudonymised IP", async () => {
    const ip = "203.0.113.88";
    for (let index = 0; index < 3; index++) {
      const response = await SELF.fetch(
        "http://localhost/api/v2/contributors",
        { method: "POST", headers: { "CF-Connecting-IP": ip } },
      );
      expect(response.status).toBe(201);
    }
    const blocked = await SELF.fetch("http://localhost/api/v2/contributors", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip },
    });
    expect(blocked.status).toBe(429);

    const keys = await env.DB.prepare("SELECT key FROM rate_limits").all<{
      key: string;
    }>();
    expect(keys.results?.some((row) => row.key.includes(ip))).toBe(false);
    expect(keys.results?.[0]?.key).toMatch(
      /^registration_ip_hmac:[0-9a-f]{64}$/,
    );
  });

  it("limits authenticated submissions per server-issued contributor", async () => {
    const credentials = await registerContributor();
    for (let index = 0; index < 60; index++) {
      const response = await postV2(credentials.submitToken, {
        mode: "history",
        observations: [makeV2Observation()],
      });
      expect(response.status).toBe(201);
    }
    const blocked = await postV2(credentials.submitToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});
