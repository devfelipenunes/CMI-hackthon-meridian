import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_LEAF,
  MAX_BIDS,
  Secret,
  assertPriceRange,
  bidCommitment,
  bidLeaf,
  bidNullifier,
  commitmentsRoot,
  newBidSecrets,
  poseidon2Hash,
} from "../../src/index.js";

const base = { price: 650n, marketId: 42n, participantId: 7, blinding: 111222333444n, nullifierSeed: 999888777n };

describe("bidCommitment (RF-10)", () => {
  it.each([
    ["blinding", { blinding: 111222333445n }],
    ["market_id", { marketId: 43n }],
    ["participant_id", { participantId: 8 }],
    ["price", { price: 651n }],
    ["nullifier_seed", { nullifierSeed: 999888778n }],
  ])("changes with %s", (_label, change) => {
    expect(bidCommitment({ ...base, ...change })).not.toBe(bidCommitment(base));
  });

  it("rejects a price out of range", () => {
    expect(() => bidCommitment({ ...base, price: 0n })).toThrow(RangeError);
  });

  it("rejects market_id that is not a u64 and participant_id that is not a u32", () => {
    expect(() => bidCommitment({ ...base, marketId: 1n << 64n })).toThrow(RangeError);
    expect(() => bidCommitment({ ...base, participantId: -1 })).toThrow(RangeError);
  });
});

describe("bidNullifier (RF-15)", () => {
  it("changes with market_id", () => {
    expect(bidNullifier(999888777n, 42n, 7)).not.toBe(bidNullifier(999888777n, 43n, 7));
  });

  it("changes with participant_id", () => {
    expect(bidNullifier(999888777n, 42n, 7)).not.toBe(bidNullifier(999888777n, 42n, 8));
  });
});

describe("assertPriceRange", () => {
  it("rejects 0 and 2^63", () => {
    expect(() => assertPriceRange(0n)).toThrow(RangeError);
    expect(() => assertPriceRange(1n << 63n)).toThrow(RangeError);
  });

  it("accepts 1 and 2^63 − 1", () => {
    expect(() => assertPriceRange(1n)).not.toThrow();
    expect(() => assertPriceRange((1n << 63n) - 1n)).not.toThrow();
  });

  it("does not put the price in the error message (S-16)", () => {
    expect(() => assertPriceRange(9_223_372_036_854_775_999n)).toThrow(/^(?!.*9223372036854775999)/);
  });
});

describe("bidLeaf and commitmentsRoot (RF-16)", () => {
  it("leaf rejects a bid_index ≥ MAX_BIDS", () => {
    expect(() => bidLeaf(MAX_BIDS, 1n)).toThrow(RangeError);
  });

  it("root pads with raw EMPTY_LEAF, not leaf(i, EMPTY_LEAF)", () => {
    const c = bidCommitment(base);
    const expected = poseidon2Hash([bidLeaf(0, c), ...new Array(MAX_BIDS - 1).fill(EMPTY_LEAF)]);
    expect(commitmentsRoot([c])).toBe(expected);
  });

  it("root depends on order (bid_index is the position)", () => {
    const a = bidCommitment(base);
    const b = bidCommitment({ ...base, participantId: 8 });
    expect(commitmentsRoot([a, b])).not.toBe(commitmentsRoot([b, a]));
  });

  it("root rejects more than MAX_BIDS commitments", () => {
    expect(() => commitmentsRoot(new Array(MAX_BIDS + 1).fill(1n))).toThrow(RangeError);
  });
});

describe("newBidSecrets", () => {
  it("uses the injected Rng and returns Secret", () => {
    const rng = { field: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n), scalar: vi.fn() };
    const secrets = newBidSecrets(650n, rng);
    expect(secrets).toBeInstanceOf(Secret);
    expect(secrets.expose()).toEqual({ price: 650n, blinding: 111n, nullifierSeed: 222n });
    expect(rng.field).toHaveBeenCalledTimes(2);
  });

  it("rejects a price out of range before drawing randomness", () => {
    const rng = { field: vi.fn(), scalar: vi.fn() };
    expect(() => newBidSecrets(0n, rng)).toThrow(RangeError);
    expect(rng.field).not.toHaveBeenCalled();
  });

  it("uses cryptoRng by default", () => {
    const a = newBidSecrets(650n).expose();
    const b = newBidSecrets(650n).expose();
    expect(a.blinding).not.toBe(b.blinding);
  });
});
