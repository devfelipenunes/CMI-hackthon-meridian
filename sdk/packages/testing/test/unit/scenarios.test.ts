import { describe, expect, it } from "vitest";

import { AURORA } from "../../src/index.js";

describe("AURORA scenario", () => {
  it("has the journey numbers", () => {
    expect(AURORA.totalQuotas).toBe(1000);
    expect(AURORA.minPricePerQuota).toBe(500n);
    expect(AURORA.bids.map((b) => [b.name, b.price, b.quantity])).toEqual([
      ["Ana", 650n, 200],
      ["Bruno", 600n, 500],
      ["Carla", 580n, 400],
      ["Diego", 520n, 300],
    ]);
  });

  it("states the expected allocation and Ana's payment split", () => {
    expect(AURORA.expected.filled).toEqual([200, 500, 300, 0]);
    expect(AURORA.expected.ana).toEqual({ gross: 130_000n, seller: 117_000n, fee: 13_000n });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(AURORA)).toBe(true);
    expect(Object.isFrozen(AURORA.bids)).toBe(true);
  });
});
