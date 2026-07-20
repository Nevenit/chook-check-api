import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(cleanDb);

describe("retired v1 product endpoints", () => {
  it("returns 410 for v1 per-product stats", async () => {
    expect(
      (await SELF.fetch("http://localhost/api/products/woolworths%3A123/stats"))
        .status,
    ).toBe(410);
  });

  it("returns 410 for v1 search", async () => {
    expect(
      (await SELF.fetch("http://localhost/api/products/search?q=test")).status,
    ).toBe(410);
  });
});
