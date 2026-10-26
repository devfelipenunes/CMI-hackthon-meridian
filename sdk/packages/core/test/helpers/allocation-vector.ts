import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Secret, type WinnerAllocationParams } from "../../src/index.js";

export const CONTRACTS = fileURLToPath(new URL("../../../../contracts/", import.meta.url));

interface AllocationCase {
  commitments_root: string;
  requested_quantities: number[];
  filled_quantities: number[];
  bid_count: number;
  total_supply: number;
  market_id: number;
  auction_rule: number;
  clearing_price: number;
  prices: number[];
  blindings: string[];
  nullifier_seeds: string[];
  participant_ids: string[];
}

export const ALLOCATION_CASES = (JSON.parse(readFileSync(`${CONTRACTS}artifacts/parity-vectors/allocation.json`, "utf8")) as { cases: Record<string, AllocationCase> }).cases;

const hexBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

export function fixtureConfigHash(name: string): Uint8Array {
  const file = `${CONTRACTS}circuits/winner_allocation/fixtures/${name}/context.json`;
  let ctx: { config_hash: string };
  try {
    ctx = JSON.parse(readFileSync(file, "utf8")) as typeof ctx;
  } catch {
    ctx = JSON.parse(readFileSync(`${CONTRACTS}circuits/winner_allocation/fixtures/poc4_8bids/context.json`, "utf8")) as typeof ctx;
  }
  return hexBytes(ctx.config_hash);
}

export function fixturePublicInputs(name: string): Buffer {
  return readFileSync(`${CONTRACTS}artifacts/fixtures/winner_allocation/${name}/public_inputs`);
}

export function allocationParams(name: string): WinnerAllocationParams {
  const c = ALLOCATION_CASES[name]!;
  const n = c.bid_count;
  return {
    commitmentsRoot: BigInt(c.commitments_root),
    marketId: BigInt(c.market_id),
    totalSupply: c.total_supply,
    auctionRule: c.auction_rule,
    configHash: fixtureConfigHash(name),
    filled: c.filled_quantities.slice(0, n),
    clearingPrice: new Secret(BigInt(c.clearing_price)),
    bids: new Secret(
      Array.from({ length: n }, (_, i) => ({
        price: BigInt(c.prices[i]!),
        blinding: BigInt(c.blindings[i]!),
        nullifierSeed: BigInt(c.nullifier_seeds[i]!),
        participantId: Number(BigInt(c.participant_ids[i]!)),
        requestedQuantity: c.requested_quantities[i]!,
      })),
    ),
  };
}
