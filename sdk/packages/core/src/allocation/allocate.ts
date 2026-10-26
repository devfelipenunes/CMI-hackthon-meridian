import { assertPriceRange } from "../bid/bid.js";
import { MAX_BIDS } from "../hash/domains.js";
import { Secret } from "../secret.js";

export interface AllocationInput {
  price: bigint;
  requestedQuantity: number;
}

export interface Allocation {

  filled: number[];

  clearingPrice: Secret<bigint>;

  unsold: number;
}

function assertU32(v: number, name: string, min = 0): void {
  if (!Number.isInteger(v) || v < min || v > 0xffff_ffff) throw new RangeError(`${name} must be a u32 ≥ ${min}`);
}

function validate(bids: readonly AllocationInput[], totalSupply: number): void {
  if (bids.length === 0 || bids.length > MAX_BIDS) throw new RangeError(`expected 1 to ${MAX_BIDS} bids`);
  assertU32(totalSupply, "totalSupply", 1);
  for (const b of bids) {
    assertPriceRange(b.price);
    assertU32(b.requestedQuantity, "requestedQuantity", 1);
  }
}

export function applyClearingRule(bids: readonly AllocationInput[], totalSupply: number, clearingPrice: bigint): number[] {
  let aboveTotal = 0;
  let tiedUsed = 0;
  return bids.map((b) => {
    const isAbove = b.price > clearingPrice;
    const isTied = b.price === clearingPrice;
    const remaining = totalSupply - aboveTotal - tiedUsed;
    if (remaining < 0) throw new RangeError("clearing price too low for the supply");
    const filled = isAbove ? b.requestedQuantity : isTied ? Math.min(b.requestedQuantity, remaining) : 0;
    if (isAbove) aboveTotal += b.requestedQuantity;
    if (isTied) tiedUsed += filled;
    return filled;
  });
}

export function computeAllocation(bids: readonly AllocationInput[], totalSupply: number): Allocation {
  validate(bids, totalSupply);
  const order = bids.map((b, i) => ({ ...b, i })).sort((a, b) => (a.price === b.price ? a.i - b.i : a.price > b.price ? -1 : 1));

  let clearingPrice = 0n;
  let cumulative = 0;
  for (const b of order) {
    cumulative += b.requestedQuantity;
    if (cumulative >= totalSupply) {
      clearingPrice = b.price;
      break;
    }
  }

  const filled = applyClearingRule(bids, totalSupply, clearingPrice);
  const demand = bids.reduce((s, b) => s + b.requestedQuantity, 0);
  const sold = filled.reduce((s, f) => s + f, 0);
  if (sold !== Math.min(totalSupply, demand)) throw new Error("allocation invariant violated");
  return { filled, clearingPrice: new Secret(clearingPrice), unsold: totalSupply - sold };
}
