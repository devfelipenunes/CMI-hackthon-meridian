import {
  CmiError,
  Secret,
  buildWinnerAllocationWitness,
  computeAllocation,
  type AuctionPort,
  type ContractId,
  type NoirInputs,
  type Prover,
} from "@zolvency-cmi/core";

import type { DecryptedBid } from "./envelopes.js";

export interface AllocationPlan {
  auction: ContractId;

  filled: number[];

  unsold: number;

  publicInputs: Uint8Array[];
  witness: Secret<NoirInputs>;
}

export async function planAllocation(auction: AuctionPort, bids: readonly DecryptedBid[]): Promise<AllocationPlan> {
  const market = await auction.getMarket();
  const root = await auction.getCommitmentsRoot();
  const configHash = await auction.getConfigHash();
  if (root === null || configHash === null) throw new CmiError("RootMismatch", "the market has no frozen root or config hash (not closed)");

  const openings = bids.map((b) => ({ ...b.secrets.expose(), participantId: b.participantId, requestedQuantity: b.requestedQuantity }));
  const allocation = computeAllocation(openings, market.params.totalQuotas);
  const w = buildWinnerAllocationWitness({
    commitmentsRoot: root,
    marketId: market.marketId,
    totalSupply: market.params.totalQuotas,
    auctionRule: market.auctionRule,
    configHash,
    bids: new Secret(openings),
    filled: allocation.filled,
    clearingPrice: allocation.clearingPrice,
  });
  return { auction: auction.address, filled: allocation.filled, unsold: allocation.unsold, publicInputs: w.publicInputs, witness: new Secret(w.inputs) };
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export async function proveAllocation(prover: Prover, plan: AllocationPlan): Promise<{ filled: number[]; proof: Uint8Array }> {
  const { proof, publicInputs } = await prover.prove("winner_allocation", plan.witness.expose());
  const expected = plan.publicInputs.map(hex);
  if (publicInputs.length !== expected.length || publicInputs.some((v, i) => v.replace(/^0x/, "").padStart(64, "0") !== expected[i])) {
    throw new CmiError("ProofFailed", "the winner_allocation proof does not carry the plan public inputs");
  }
  return { filled: [...plan.filled], proof };
}
