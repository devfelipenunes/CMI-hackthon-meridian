import { describe, expect, it } from "vitest";

import { FR_MODULUS, addOpenings, ownerAllowance, pedersenCommit, pointAdd, recoverDelegation, type Opening } from "../../src/index.js";
import { legsScenario } from "../helpers/legs.js";

describe("ownerAllowance (lado do bidder, para revogar)", () => {
  it("the owner reads the same allowance as the spender, from its own vk", () => {
    const { f, setSpender, onChain } = legsScenario();
    const owner = ownerAllowance(onChain, f.bidder, f.params.opI).expose();
    const spender = recoverDelegation(onChain, f.auction.sk, f.params.opI).expose();
    expect(owner).toEqual({ vA: 130_000n, sigmaA: spender.sigmaA });
    expect(owner.vA).toBe(setSpender.delegation.expose().vA);
  });

  it("after a spender leg, the owner reads the remaining allowance", () => {
    const { f, legs, onChain } = legsScenario();
    const p = legs.seller.payload;
    const after = { ...onChain, allowanceCommitment: p.cANew, encryptedAllowance: p.aTildeNew, allowanceSalt: p.sigmaANew };
    expect(ownerAllowance(after, f.bidder, f.params.opI).expose().vA).toBe(130_000n - 70_200n);
  });

  it("with another account's keys the result is garbage, not an error", () => {
    const { f, onChain } = legsScenario();
    expect(ownerAllowance(onChain, f.seller, f.params.opI).expose().vA).not.toBe(130_000n);
  });
});

describe("addOpenings (merge)", () => {
  it("the sum of openings opens the sum of commitments (blindings add mod the group order)", () => {

    const big = FR_MODULUS - 1n;
    const a: Opening = { v: 200_000n, r: big };
    const b: Opening = { v: 5n, r: big };
    const s = addOpenings(a, b);
    expect(s.v).toBe(200_005n);
    expect(pedersenCommit(s.v, s.r)).toEqual(pointAdd(pedersenCommit(a.v, a.r), pedersenCommit(b.v, b.r)));
  });
});
