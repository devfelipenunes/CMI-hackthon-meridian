import { describe, expect, it } from "vitest";

import { FR_MODULUS, GRUMPKIN_G, TOKEN_H, ecdh, pedersenCommit, pointAdd, scalarMul } from "../../src/index.js";

describe("curve", () => {
  it("ecdh is commutative (a·(b·G) == b·(a·G))", () => {
    const a = 0x1234_5678_9abc_def0n;
    const b = 0x0fed_cba9_8765_4321n;
    expect(ecdh(a, scalarMul(b, GRUMPKIN_G))).toEqual(ecdh(b, scalarMul(a, GRUMPKIN_G)));
  });

  it("pedersenCommit is additively homomorphic (base of the settlement legs)", () => {
    const left = pointAdd(pedersenCommit(70_200n, 11n), pedersenCommit(7_800n, 22n));
    expect(left).toEqual(pedersenCommit(78_000n, 33n));
  });

  it("commit(0, 0) is the identity (0, 0)", () => {
    expect(pedersenCommit(0n, 0n)).toEqual({ x: 0n, y: 0n });
  });

  it("scalarMul by 0 is the identity and adding the identity is a no-op", () => {
    const id = scalarMul(0n, TOKEN_H);
    expect(id).toEqual({ x: 0n, y: 0n });
    expect(pointAdd(TOKEN_H, id)).toEqual(TOKEN_H);
  });

  it("rejects a point that is not on the curve", () => {
    expect(() => scalarMul(2n, { x: 1n, y: 2n })).toThrow(RangeError);
  });

  it("rejects a scalar that is not a field element (no silent reduction)", () => {
    expect(() => scalarMul(FR_MODULUS, GRUMPKIN_G)).toThrow(RangeError);
    expect(() => pedersenCommit(-1n, 1n)).toThrow(RangeError);
  });

  it("ecdh rejects a degenerate result (identity)", () => {
    expect(() => ecdh(0n, GRUMPKIN_G)).toThrow(RangeError);
  });
});
