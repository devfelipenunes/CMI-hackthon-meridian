import { describe, expect, it } from "vitest";

import { MAX_BIDS, Secret, applyClearingRule, computeAllocation, settlementAmounts } from "../../src/index.js";

const bids = (rows: Array<[bigint, number]>) => rows.map(([price, requestedQuantity]) => ({ price, requestedQuantity }));

const AURORA = bids([
  [650n, 200],
  [600n, 500],
  [580n, 400],
  [520n, 300],
]);

describe("computeAllocation (RF-17, ADR-019)", () => {
  it("aurora: Ana 200, Bruno 500, Carla 300, Diego 0", () => {
    const a = computeAllocation(AURORA, 1000);
    expect(a.filled).toEqual([200, 500, 300, 0]);
    expect(a.unsold).toBe(0);
  });

  it("undersubscription fills everyone and reports unsold", () => {
    const a = computeAllocation(bids([[650n, 200], [600n, 400]]), 1000);
    expect(a.filled).toEqual([200, 400]);
    expect(a.unsold).toBe(400);
  });

  it("tied bid shut out when margin is exhausted", () => {
    const a = computeAllocation(bids([[700n, 600], [500n, 400], [500n, 300]]), 1000);
    expect(a.filled).toEqual([600, 400, 0]);
  });

  it("single bid", () => {
    expect(computeAllocation(bids([[650n, 300]]), 1000).filled).toEqual([300]);
    expect(computeAllocation(bids([[650n, 3000]]), 1000).filled).toEqual([1000]);
  });

  it("clearingPrice may fall between two prices (gap, OQ-09): same fills", () => {
    const b = bids([[650n, 200], [600n, 800], [550n, 100]]);
    const a = computeAllocation(b, 1000);
    expect(a.filled).toEqual([200, 800, 0]);
    expect(applyClearingRule(b, 1000, 575n)).toEqual(a.filled);
  });

  it("filled follows the circuit's accumulator for the returned clearing price", () => {
    const a = computeAllocation(AURORA, 1000);
    expect(applyClearingRule(AURORA, 1000, a.clearingPrice.expose())).toEqual(a.filled);
  });

  it("sum(filled) == min(supply, sum(requested)) and filled ≤ requested (200 random cases)", () => {
    let seed = 12345;
    const next = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let t = 0; t < 200; t++) {
      const count = 1 + next(MAX_BIDS);
      const b = bids(Array.from({ length: count }, () => [BigInt(500 + next(5) * 10), 1 + next(400)] as [bigint, number]));
      const supply = 1 + next(1500);
      const a = computeAllocation(b, supply);
      const demand = b.reduce((s, x) => s + x.requestedQuantity, 0);
      expect(a.filled.reduce((s, x) => s + x, 0)).toBe(Math.min(supply, demand));
      a.filled.forEach((f, i) => expect(f).toBeLessThanOrEqual(b[i]!.requestedQuantity));
      expect(applyClearingRule(b, supply, a.clearingPrice.expose())).toEqual(a.filled);
    }
  });

  it("clearingPrice is a Secret (it reveals a bid price)", () => {
    expect(computeAllocation(AURORA, 1000).clearingPrice).toBeInstanceOf(Secret);
  });

  it.each([
    ["more than MAX_BIDS bids", Array.from({ length: MAX_BIDS + 1 }, () => ({ price: 1n, requestedQuantity: 1 })), 10],
    ["a zero quantity", bids([[650n, 0]]), 10],
    ["a price out of range", bids([[0n, 1]]), 10],
    ["a zero supply", bids([[650n, 1]]), 0],
  ])("rejects %s", (_label, b, supply) => {
    expect(() => computeAllocation(b, supply)).toThrow(RangeError);
  });

  it("rejects an empty bid set", () => {
    expect(() => computeAllocation([], 10)).toThrow(RangeError);
  });
});

describe("settlementAmounts (ADR-023, ADR-026)", () => {
  it("seller + fee + refund == price × requested (property)", () => {
    for (const [price, requested, filled] of [
      [650n, 200, 120],
      [1n, 1, 1],
      [(1n << 63n) - 1n, 0xffff_ffff, 0x7fff_ffff],
      [580n, 400, 0],
      [600n, 500, 500],
    ] as const) {
      const a = settlementAmounts(price, requested, filled).expose();
      expect(a.seller + a.fee + a.refund).toBe(price * BigInt(requested));
      expect(a.gross).toBe(price * BigInt(filled));
    }
  });

  it("fee is floor(gross × 10%) by default (FEE_BPS = 1000)", () => {
    expect(settlementAmounts(65n, 1, 1).expose().fee).toBe(6n);
  });

  it("aurora: Ana pays 130.000 → seller 117.000, fee 13.000", () => {
    const a = settlementAmounts(650n, 200, 200).expose();
    expect([a.gross, a.seller, a.fee, a.refund]).toEqual([130_000n, 117_000n, 13_000n, 0n]);
  });

  it("returns a Secret (individual payment amounts are private, G3)", () => {
    expect(settlementAmounts(650n, 200, 120)).toBeInstanceOf(Secret);
  });

  it.each([
    ["filled > requested", 650n, 10, 11, 1000n],
    ["feeBps > 10000", 650n, 10, 5, 10_001n],
    ["price out of range", 0n, 10, 5, 1000n],
    ["negative quantity", 650n, -1, 0, 1000n],
  ])("rejects %s", (_label, price, requested, filled, bps) => {
    expect(() => settlementAmounts(price, requested, filled, bps)).toThrow(RangeError);
  });
});
