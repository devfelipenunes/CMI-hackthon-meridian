import { describe, expect, it } from "vitest";

import { WINNER_ALLOCATION_PUBLIC_INPUTS, buildWinnerAllocationWitness, computeAllocation, winnerAllocationPublicInputs } from "../../src/index.js";
import { ALLOCATION_CASES, allocationParams, fixturePublicInputs } from "../helpers/allocation-vector.js";

describe("winner_allocation: paridade com os contratos", () => {
  it.each(["poc4_8bids", "undersubscribed"])("public inputs are the 23 fields in the frozen order (%s)", (name) => {
    const p = allocationParams(name);
    const bids = p.bids.expose();
    const pi = winnerAllocationPublicInputs({
      commitmentsRoot: p.commitmentsRoot,
      requested: bids.map((b) => b.requestedQuantity),
      filled: p.filled,
      totalSupply: p.totalSupply,
      marketId: p.marketId,
      auctionRule: p.auctionRule,
      configHash: p.configHash,
    });
    expect(WINNER_ALLOCATION_PUBLIC_INPUTS).toHaveLength(23);
    expect(pi).toHaveLength(23);
    expect(Buffer.concat(pi)).toEqual(fixturePublicInputs(name));
    expect(buildWinnerAllocationWitness(p).publicInputs).toEqual(pi);
  });

  it.each(Object.keys(ALLOCATION_CASES))("computeAllocation matches contracts allocation.json (%s)", (name) => {
    const c = ALLOCATION_CASES[name]!;
    const bids = Array.from({ length: c.bid_count }, (_, i) => ({ price: BigInt(c.prices[i]!), requestedQuantity: c.requested_quantities[i]! }));
    const a = computeAllocation(bids, c.total_supply);
    expect(a.filled).toEqual(c.filled_quantities.slice(0, c.bid_count));
    expect(a.clearingPrice.expose()).toBe(BigInt(c.clearing_price));
  });
});
