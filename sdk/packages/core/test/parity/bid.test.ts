import { describe, expect, it } from "vitest";

import { DOMAIN, EMPTY_LEAF, MAX_BIDS, bidCommitment, bidLeaf, bidNullifier, commitmentsRoot, poseidon2Hash } from "../../src/index.js";
import vectors from "../vectors/cmi-lib.json" with { type: "json" };

const v = vectors.bid;
const opening = {
  price: BigInt(v.price),
  marketId: BigInt(v.marketId),
  participantId: v.participantId,
  blinding: BigInt(v.blinding),
  nullifierSeed: BigInt(v.nullifierSeed),
};

describe("bid parity with cmi_lib", () => {
  it("commitment matches RF-10 vector", () => {
    expect(bidCommitment(opening)).toBe(BigInt(v.commitment));
  });

  it("nullifier matches cmi_lib bid::nullifier", () => {
    expect(bidNullifier(opening.nullifierSeed, opening.marketId, opening.participantId)).toBe(BigInt(v.nullifier));
  });

  it.each([
    [0, v.leaf0],
    [7, v.leaf7],
  ])("leaf(%i, C) matches Poseidon2(1003, i, C)", (i, expected) => {
    expect(bidLeaf(i, BigInt(v.commitment))).toBe(BigInt(expected));
  });
});

describe("commitmentsRoot parity with crypto.rs", () => {
  it("root of empty market is hash of 8 raw EMPTY_LEAF", () => {
    const root = commitmentsRoot([]);
    expect(root).toBe(BigInt(vectors.root.empty));
    expect(root).toBe(poseidon2Hash(new Array(MAX_BIDS).fill(EMPTY_LEAF)));
  });

  it("root pads to 8 and matches the POC-4 vector", () => {
    const { prices, blindings, commitment0, root } = vectors.root.poc4;

    const commitments = prices.map((p, i) => poseidon2Hash([DOMAIN.BID_COMMIT, BigInt(p), BigInt(blindings[i]!)]));
    expect(commitments[0]).toBe(BigInt(commitment0));
    expect(commitmentsRoot(commitments)).toBe(BigInt(root));
  });
});
