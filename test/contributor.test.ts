import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { cleanDb } from "./helpers";
import { makeV2Observation, postV2, registerContributor } from "./v2-helpers";

beforeEach(cleanDb);

async function deleteV2(token: string) {
  return SELF.fetch("http://localhost/api/v2/contributor", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("DELETE /api/v2/contributor", () => {
  it("deletes only the contributor authenticated by the deletion token", async () => {
    const first = await registerContributor("203.0.113.1");
    const second = await registerContributor("203.0.113.2");
    await postV2(first.submitToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });
    await postV2(second.submitToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });

    const response = await deleteV2(first.deletionToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: 1 });
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM observations_v2",
    ).first<{ count: number }>();
    expect(remaining?.count).toBe(1);
  });

  it("does not accept a submit token for deletion", async () => {
    const credentials = await registerContributor();
    expect((await deleteV2(credentials.submitToken)).status).toBe(401);
  });

  it("does not accept a deletion token for submission", async () => {
    const credentials = await registerContributor();
    const response = await postV2(credentials.deletionToken, {
      mode: "history",
      observations: [makeV2Observation()],
    });
    expect(response.status).toBe(401);
  });

  it("invalidates the contributor after deletion", async () => {
    const credentials = await registerContributor();
    expect((await deleteV2(credentials.deletionToken)).status).toBe(200);
    expect((await deleteV2(credentials.deletionToken)).status).toBe(401);
  });

  it("returns 410 for UUID-only legacy deletion", async () => {
    const response = await SELF.fetch(
      "http://localhost/api/contributor/00000000-0000-0000-0000-000000000001",
      { method: "DELETE" },
    );
    expect(response.status).toBe(410);
  });
});
