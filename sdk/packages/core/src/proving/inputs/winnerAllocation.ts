import type { Field } from "../../field/field.js";
import { hashLimbs, toBytes32BE, u32Field, u64Field } from "../../field/encoding.js";
import { MAX_BIDS } from "../../hash/domains.js";
import type { Secret } from "../../secret.js";
import type { NoirInputs } from "../prover.js";

export const WINNER_ALLOCATION_PUBLIC_INPUTS = [
  "commitments_root",
  ...Array.from({ length: MAX_BIDS }, (_, i) => `requested_quantities[${i}]`),
  ...Array.from({ length: MAX_BIDS }, (_, i) => `filled_quantities[${i}]`),
  "bid_count",
  "total_supply",
  "market_id",
  "auction_rule",
  "config_hash_lo",
  "config_hash_hi",
] as const;

export interface WinnerAllocationPublic {
  commitmentsRoot: Field;

  requested: readonly number[];
  filled: readonly number[];
  totalSupply: number;
  marketId: bigint;
  auctionRule: number;

  configHash: Uint8Array;
}

export interface AllocationBidOpening {
  price: bigint;
  blinding: Field;
  nullifierSeed: Field;
  participantId: number;
  requestedQuantity: number;
}

export interface WinnerAllocationParams {
  commitmentsRoot: Field;
  marketId: bigint;
  totalSupply: number;
  auctionRule: number;
  configHash: Uint8Array;

  bids: Secret<readonly AllocationBidOpening[]>;
  filled: readonly number[];

  clearingPrice: Secret<bigint>;
}

function padded(values: readonly number[], name: string): number[] {
  if (values.length > MAX_BIDS) throw new RangeError(`${name}: at most ${MAX_BIDS} entries`);
  return Array.from({ length: MAX_BIDS }, (_, i) => values[i] ?? 0);
}

export function winnerAllocationPublicInputs(a: WinnerAllocationPublic): Uint8Array[] {
  if (a.filled.length !== a.requested.length) throw new RangeError("filled and requested must have one entry per bid");
  if (a.configHash.length !== 32) throw new RangeError("config_hash must be 32 bytes");
  const { lo, hi } = hashLimbs(a.configHash);
  return [
    toBytes32BE(a.commitmentsRoot),
    ...padded(a.requested, "requested").map((q) => u64Field(BigInt(q))),
    ...padded(a.filled, "filled").map((q) => u64Field(BigInt(q))),
    u32Field(a.requested.length),
    u64Field(BigInt(a.totalSupply)),
    u64Field(a.marketId),
    u64Field(BigInt(a.auctionRule)),
    toBytes32BE(lo),
    toBytes32BE(hi),
  ];
}

const hex = (v: bigint): string => `0x${v.toString(16).padStart(64, "0")}`;
const bytesHex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

export function buildWinnerAllocationWitness(p: WinnerAllocationParams): { inputs: NoirInputs; publicInputs: Uint8Array[] } {
  const bids = p.bids.expose();
  const publicInputs = winnerAllocationPublicInputs({
    commitmentsRoot: p.commitmentsRoot,
    requested: bids.map((b) => b.requestedQuantity),
    filled: p.filled,
    totalSupply: p.totalSupply,
    marketId: p.marketId,
    auctionRule: p.auctionRule,
    configHash: p.configHash,
  });
  const at = (i: number): string => bytesHex(publicInputs[i]!);
  const pad = <T>(f: (b: AllocationBidOpening) => T, zero: T): T[] => Array.from({ length: MAX_BIDS }, (_, i) => (bids[i] === undefined ? zero : f(bids[i]!)));
  const inputs: NoirInputs = {
    commitments_root: at(0),
    requested_quantities: Array.from({ length: MAX_BIDS }, (_, i) => at(1 + i)),
    filled_quantities: Array.from({ length: MAX_BIDS }, (_, i) => at(1 + MAX_BIDS + i)),
    bid_count: at(17),
    total_supply: at(18),
    market_id: at(19),
    auction_rule: at(20),
    config_hash_lo: at(21),
    config_hash_hi: at(22),
    clearing_price: hex(p.clearingPrice.expose()),
    prices: pad((b) => hex(b.price), hex(0n)),
    blindings: pad((b) => hex(b.blinding), hex(0n)),
    nullifier_seeds: pad((b) => hex(b.nullifierSeed), hex(0n)),
    participant_ids: pad((b) => hex(BigInt(b.participantId)), hex(0n)),
  };
  return { inputs, publicInputs };
}
