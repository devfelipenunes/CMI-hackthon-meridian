import { describe, expect, it } from "vitest";

import { computeAllocation, settlementAmounts } from "../../src/index.js";
import vectors from "../vectors/cmi-lib.json" with { type: "json" };

describe("computeAllocation parity with POC-4", () => {
  it.each(vectors.allocation.scenarios.map((s) => [s.name, s] as const))("%s", (_name, s) => {
    const bids = s.prices.map((p, i) => ({ price: BigInt(p), requestedQuantity: s.requested[i]! }));
    const a = computeAllocation(bids, s.supply);
    expect(a.filled).toEqual(s.filled);
    if ("clearingPrice" in s) expect(a.clearingPrice.expose()).toBe(BigInt(s.clearingPrice));
  });
});

describe("settlementAmounts parity with POC-6", () => {
  it.each(vectors.settlement.cases.map((c) => [c.gross, c] as const))("gross %s", (_g, c) => {
    const a = settlementAmounts(BigInt(c.price), c.requested, c.filled, BigInt(c.feeBps)).expose();
    expect(a).toEqual({
      gross: BigInt(c.gross),
      fee: BigInt(c.fee),
      feeRem: BigInt(c.feeRem),
      seller: BigInt(c.seller),
      refund: BigInt(c.refund),
    });
  });
});
