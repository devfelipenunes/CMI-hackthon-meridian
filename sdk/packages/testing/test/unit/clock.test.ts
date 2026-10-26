import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/index.js";

describe("FakeClock", () => {
  it("advanceTo moves the ledger", async () => {
    const c = new FakeClock(100);
    expect(await c.ledger()).toBe(100);
    c.advanceTo(518_500);
    expect(await c.ledger()).toBe(518_500);
  });

  it("advanceBy adds ledgers", async () => {
    const c = new FakeClock(10);
    c.advanceBy(5);
    expect(await c.ledger()).toBe(15);
  });

  it("refuses to go back in time", () => {
    const c = new FakeClock(100);
    expect(() => c.advanceTo(99)).toThrow();
  });
});
