import { scValToNative, xdr } from "@stellar/stellar-sdk";

import { AUCTION_SPEC } from "../bindings/auction.js";
import type { ChainClient, TxResult } from "../chain/client.js";
import type { AccountId, ContractId } from "../chain/events.js";
import type { Signer } from "../chain/signer.js";
import type { MarketConfig } from "../config/types.js";
import type { BidEnvelope } from "../envelope/envelope.js";
import { CmiError } from "../errors/CmiError.js";
import { fromBytes32BE, pointFromBytes, pointToBytes, toBytes32BE } from "../field/encoding.js";
import type { Field } from "../field/field.js";
import { addrVal, bytesOf, bytesVal, lazySpec, marketConfigFromNative, tagOf, u32Val, udt } from "./scval.js";

export type MarketStatus = "Created" | "Open" | "Closed" | "Finalized" | "Settled" | "Cancelled";
export type BidStatus = "Pending" | "Settled" | "Failed";
export type SettleOutcome = "Settled" | "AlreadySettled";

export interface BidSubmission {
  requestedQuantity: number;
  commitment: Field;
  nullifier: Field;
  envelope: BidEnvelope;

  proof: Uint8Array;
}

export interface BidRecord {
  bidder: AccountId;
  participantId: number;
  commitment: Field;
  nullifier: Field;
  requestedQuantity: number;
  envelope: BidEnvelope;
  filledQuantity: number;
  status: BidStatus;
}

export interface SettlementLegs {
  sellerData: Uint8Array;
  feeData: Uint8Array;
  refundData: Uint8Array;
}

export type AuctionEvent =
  | { kind: "MarketOpened"; ledger: number; marketId: bigint; configHash: Uint8Array; totalQuotas: number }
  | { kind: "ParticipantRegistered"; ledger: number; participant: AccountId; participantId: number }
  | { kind: "BidAccepted"; ledger: number; bidder: AccountId; bidIndex: number; requestedQuantity: number }
  | { kind: "MarketClosed"; ledger: number; marketId: bigint; bidCount: number; commitmentsRoot: Field; finalizeByLedger: number }
  | { kind: "MarketFinalized"; ledger: number; marketId: bigint; filled: number[]; unsold: number }
  | { kind: "BidSettled"; ledger: number; bidder: AccountId; bidIndex: number; filledQuantity: number }
  | { kind: "BidFailed"; ledger: number; bidder: AccountId; bidIndex: number; filledQuantity: number }
  | { kind: "MarketSettled"; ledger: number; marketId: bigint }
  | { kind: "MarketCancelled"; ledger: number; marketId: bigint; reason: string };

export interface AuctionPort {
  readonly address: ContractId;
  getMarket(): Promise<MarketConfig>;
  getState(): Promise<MarketStatus>;
  getParticipantId(a: AccountId): Promise<number | null>;
  getParticipant(id: number): Promise<AccountId | null>;
  getBidCount(): Promise<number>;
  getBidRecord(i: number): Promise<BidRecord>;
  getAllocation(): Promise<number[]>;
  getConfigHash(): Promise<Uint8Array | null>;
  getCommitmentsRoot(): Promise<Field | null>;
  getFinalizeByLedger(): Promise<number | null>;
  getSettlementStatus(i: number): Promise<BidStatus>;
  hasNullifier(n: Field): Promise<boolean>;
  getFeeReserve(): Promise<bigint>;
  openMarket(seller: Signer): Promise<TxResult>;
  cancelMarket(seller: Signer): Promise<TxResult>;
  registerParticipant(p: Signer): Promise<number>;
  submitBid(bidder: Signer, bid: BidSubmission): Promise<number>;
  closeMarket(caller: Signer): Promise<TxResult>;
  finalize(caller: Signer, filled: number[], proof: Uint8Array): Promise<TxResult>;
  cancelExpired(caller: Signer): Promise<TxResult>;
  settle(caller: Signer, bidIndex: number, legs: SettlementLegs, proof: Uint8Array): Promise<SettleOutcome>;
  releaseUnsettled(caller: Signer, bidIndex: number): Promise<TxResult>;

  events(q: { startLedger: number }): Promise<AuctionEvent[]>;
}

const spec = lazySpec(AUCTION_SPEC);

const envelopeToNative = (e: BidEnvelope) => ({
  r_point: Buffer.from(pointToBytes(e.rPoint)),
  ct_price: Buffer.from(toBytes32BE(e.ctPrice)),
  ct_blinding: Buffer.from(toBytes32BE(e.ctBlinding)),
  ct_seed: Buffer.from(toBytes32BE(e.ctSeed)),
});

function envelopeFromNative(n: Record<string, unknown>): BidEnvelope {
  return {
    rPoint: pointFromBytes(bytesOf(n.r_point, "r_point")),
    ctPrice: fromBytes32BE(bytesOf(n.ct_price, "ct_price")),
    ctBlinding: fromBytes32BE(bytesOf(n.ct_blinding, "ct_blinding")),
    ctSeed: fromBytes32BE(bytesOf(n.ct_seed, "ct_seed")),
  };
}

function bidRecordFromNative(n: Record<string, unknown>): BidRecord {
  return {
    bidder: n.bidder as string,
    participantId: n.participant_id as number,
    commitment: fromBytes32BE(bytesOf(n.commitment, "commitment")),
    nullifier: fromBytes32BE(bytesOf(n.nullifier, "nullifier")),
    requestedQuantity: n.requested_quantity as number,
    envelope: envelopeFromNative(n.envelope as Record<string, unknown>),
    filledQuantity: n.filled_quantity as number,
    status: tagOf(n.status, "status") as BidStatus,
  };
}

const unitEnum = (v: xdr.ScVal, what: string): string => tagOf({ tag: (scValToNative(v) as unknown[])[0] }, what);

const option = <T>(v: xdr.ScVal, some: (v: xdr.ScVal) => T): T | null => (v.switch() === xdr.ScValType.scvVoid() ? null : some(v));

export function chainAuctionPort(cfg: { chain: ChainClient; address: ContractId }): AuctionPort {
  const { chain, address } = cfg;
  const opts = { errors: "Auction" } as const;
  const read = (method: string, args: xdr.ScVal[] = []) => chain.simulate(address, method, args, opts);
  const write = (s: Signer, method: string, args: xdr.ScVal[]) => chain.invoke(address, method, args, s, opts);
  const caller = (s: Signer) => addrVal(s.address);
  const returned = (r: TxResult, method: string): xdr.ScVal => {
    if (r.returnValue === undefined) throw new CmiError("TxFailed", `${method}: no return value`);
    return r.returnValue;
  };

  return {
    address,
    getMarket: async () => marketConfigFromNative(spec().funcResToNative("get_market", await read("get_market"))),
    getState: async () => tagOf(spec().funcResToNative("get_state", await read("get_state")), "state") as MarketStatus,
    getParticipantId: async (a) => option(await read("get_participant_id", [addrVal(a)]), (v) => v.u32()),
    getParticipant: async (id) => option(await read("get_participant", [u32Val(id)]), (v) => scValToNative(v) as string),
    getBidCount: async () => (await read("get_bid_count")).u32(),
    getBidRecord: async (i) => bidRecordFromNative(spec().funcResToNative("get_bid_record", await read("get_bid_record", [u32Val(i)]))),
    getAllocation: async () => ((await read("get_allocation")).vec() ?? []).map((v) => v.u32()),
    getConfigHash: async () => option(await read("get_config_hash"), (v) => new Uint8Array(v.bytes())),
    getCommitmentsRoot: async () => option(await read("get_commitments_root"), (v) => fromBytes32BE(new Uint8Array(v.bytes()))),
    getFinalizeByLedger: async () => option(await read("get_finalize_by_ledger"), (v) => v.u32()),
    getSettlementStatus: async (i) => unitEnum(await read("get_settlement_status", [u32Val(i)]), "status") as BidStatus,
    hasNullifier: async (n) => (await read("has_nullifier", [bytesVal(toBytes32BE(n))])).b(),
    getFeeReserve: async () => BigInt(scValToNative(await read("get_fee_reserve")) as bigint),

    openMarket: (s) => write(s, "open_market", []),
    cancelMarket: (s) => write(s, "cancel_market", []),
    registerParticipant: async (s) => returned(await write(s, "register_participant", [caller(s)]), "register_participant").u32(),
    submitBid: async (s, bid) => {
      const native = {
        requested_quantity: bid.requestedQuantity,
        commitment: Buffer.from(toBytes32BE(bid.commitment)),
        nullifier: Buffer.from(toBytes32BE(bid.nullifier)),
        envelope: envelopeToNative(bid.envelope),
        proof: Buffer.from(bid.proof),
      };
      const r = await write(s, "submit_bid", [caller(s), spec().nativeToScVal(native, udt("BidSubmission"))]);
      return returned(r, "submit_bid").u32();
    },
    closeMarket: (s) => write(s, "close_market", [caller(s)]),
    finalize: (s, filled, proof) => write(s, "finalize", [caller(s), xdr.ScVal.scvVec(filled.map(u32Val)), bytesVal(proof)]),
    cancelExpired: (s) => write(s, "cancel_expired", [caller(s)]),
    settle: async (s, i, legs, proof) => {
      const r = await write(s, "settle", [caller(s), u32Val(i), bytesVal(legs.sellerData), bytesVal(legs.feeData), bytesVal(legs.refundData), bytesVal(proof)]);
      return unitEnum(returned(r, "settle"), "outcome") as SettleOutcome;
    },
    releaseUnsettled: (s, i) => write(s, "release_unsettled", [caller(s), u32Val(i)]),

    events: async ({ startLedger }) => {
      const out: AuctionEvent[] = [];
      for await (const e of chain.events({ contractIds: [address], startLedger })) {
        const ev = auctionEventFrom(e.topics, e.data, e.ledger ?? 0);
        if (ev !== null) out.push(ev);
      }
      return out;
    },
  };
}

export function auctionEventFrom(topics: xdr.ScVal[], data: xdr.ScVal, ledger: number): AuctionEvent | null {
  const name = topics[0]?.switch() === xdr.ScValType.scvSymbol() ? topics[0].sym().toString() : "";
  const t1 = topics[1];
  const f = new Map((data.map() ?? []).map((e) => [e.key().sym().toString(), e.val()]));
  const u32 = (k: string): number => f.get(k)!.u32();
  const id = (): bigint => BigInt(scValToNative(t1!) as bigint);
  const who = (): AccountId => scValToNative(t1!) as string;
  switch (name) {
    case "market_opened":
      return { kind: "MarketOpened", ledger, marketId: id(), configHash: new Uint8Array(f.get("config_hash")!.bytes()), totalQuotas: u32("total_quotas") };
    case "participant_registered":
      return { kind: "ParticipantRegistered", ledger, participant: who(), participantId: u32("participant_id") };
    case "bid_accepted":
      return { kind: "BidAccepted", ledger, bidder: who(), bidIndex: u32("bid_index"), requestedQuantity: u32("requested_quantity") };
    case "market_closed":
      return {
        kind: "MarketClosed", ledger, marketId: id(), bidCount: u32("bid_count"),
        commitmentsRoot: fromBytes32BE(new Uint8Array(f.get("commitments_root")!.bytes())), finalizeByLedger: u32("finalize_by_ledger"),
      };
    case "market_finalized":
      return { kind: "MarketFinalized", ledger, marketId: id(), filled: (f.get("filled_quantities")!.vec() ?? []).map((v) => v.u32()), unsold: u32("unsold") };
    case "bid_settled":
      return { kind: "BidSettled", ledger, bidder: who(), bidIndex: u32("bid_index"), filledQuantity: u32("filled_quantity") };
    case "bid_failed":
      return { kind: "BidFailed", ledger, bidder: who(), bidIndex: u32("bid_index"), filledQuantity: u32("filled_quantity") };
    case "market_settled":
      return { kind: "MarketSettled", ledger, marketId: id() };
    case "market_cancelled":
      return { kind: "MarketCancelled", ledger, marketId: id(), reason: f.get("reason")!.sym().toString() };
    default:
      return null;
  }
}
