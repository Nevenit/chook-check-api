import { describe, it, expect } from "vitest";
import { median, promoFrequency, trendChange } from "../src/lib/aggregation";

describe("median", () => {
  it("returns the middle value for odd-length arrays", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns average of two middle values for even-length arrays", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns the single value for length-1 arrays", () => {
    expect(median([42])).toBe(42);
  });

  it("returns 0 for empty arrays", () => {
    expect(median([])).toBe(0);
  });

  it("handles unsorted input", () => {
    expect(median([5, 1, 3, 9, 7])).toBe(5);
  });
});

describe("promoFrequency", () => {
  it("calculates proportions for each promo type", () => {
    const types = ["member_price", "member_price", "none", "half_price", "none"];
    const result = promoFrequency(types);
    expect(result["member_price"]).toBeCloseTo(0.4);
    expect(result["half_price"]).toBeCloseTo(0.2);
    expect(result["none"]).toBeCloseTo(0.4);
  });

  it("returns empty object for empty array", () => {
    expect(promoFrequency([])).toEqual({});
  });

  it("handles null promo types by using 'none'", () => {
    const types = [null, "member_price", null];
    const result = promoFrequency(types);
    expect(result["none"]).toBeCloseTo(2 / 3);
    expect(result["member_price"]).toBeCloseTo(1 / 3);
  });
});

describe("trendChange", () => {
  it("calculates positive change", () => {
    const result = trendChange(450, 400);
    expect(result.changePercent).toBeCloseTo(12.5);
    expect(result.direction).toBe("up");
  });

  it("calculates negative change", () => {
    const result = trendChange(400, 450);
    expect(result.changePercent).toBeCloseTo(-11.11, 1);
    expect(result.direction).toBe("down");
  });

  it("returns zero change for equal prices", () => {
    const result = trendChange(500, 500);
    expect(result.changePercent).toBe(0);
    expect(result.direction).toBe("up");
  });
});
