import { describe, expect, it } from "vitest";

import { Secret, buildSettlementBindingWitness, type Point } from "../../src/index.js";

const P: Point = { x: 1n, y: 2n };

function witness(price: bigint, requested: number, filled: number) {
  return buildSettlementBindingWitness({
    commitment: 1n,
    requested,
    filled,
    feeBps: 1_000,
    cSeller: P,
    cFee: P,
    cRefund: P,
    opening: new Secret({ price, marketId: 42n, participantId: 0, blinding: 1n, nullifierSeed: 2n }),
    blindings: new Secret({ rSeller: 3n, rFee: 4n, rRefund: 5n }),
  });
}

describe("buildSettlementBindingWitness", () => {
  it("fee is floor(gross × 10%)", () => {

    const w = witness(13n, 5, 5);
    expect(BigInt(w.inputs.fee as string)).toBe(6n);
    expect(BigInt(w.inputs.fee_rem as string)).toBe(5_000n);

    const carla = witness(580n, 400, 300);
    expect(BigInt(carla.inputs.fee as string)).toBe(17_400n);
    expect(BigInt(carla.inputs.fee_rem as string)).toBe(0n);
  });

  it("refuses filled > requested before any proof", () => {
    expect(() => witness(650n, 100, 101)).toThrow(RangeError);
  });
});
