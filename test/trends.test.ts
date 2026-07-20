import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { cleanDb } from "./helpers";

beforeEach(cleanDb);

describe("retired v1 trend endpoint", () => {
  it("returns 410", async () => {
    expect((await SELF.fetch("http://localhost/api/trends")).status).toBe(410);
  });
});
