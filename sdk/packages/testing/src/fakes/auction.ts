import { StrKey } from "@stellar/stellar-sdk";
import {
  CmiError,
  FEE_BPS,
  FINALIZATION_GRACE_LEDGERS,
  MAX_BIDS,
  SETTLEMENT_MARGIN_LEDGERS,
  commitmentsRoot,
  configHash,
  type AuctionEvent,
  type AuctionPort,
  type BidRecord,
  type BidStatus,
  type BidSubmission,
  type Clock,
  type CmiErrorCode,
  type Field,
  type MarketConfig,
  type MarketParams,
  type MarketStatus,
  type PlatformConfig,
  type SettleOutcome,
  type SettlementLegs,
  type Signer,
  type TokenPort,
  type TxResult,
} from "@zolvency-cmi/core";

import { contractError, type CallLog } from "./log.js";

export const MARKET_TRANSITIONS: readonly (readonly [MarketStatus, MarketStatus])[] = [
  ["Created", "Open"],
  ["Created", "Cancelled"],
  ["Open", "Closed"],
  ["Open", "Cancelled"],
  ["Closed", "Finalized"],
  ["Closed", "Cancelled"],
  ["Finalized", "Settled"],
];

const contract = (seed: number): string => StrKey.encodeContract(Buffer.alloc(32, seed));

export const FAKE_PLATFORM: PlatformConfig = {
  collateralToken: contract(201),
  feeAsset: contract(202),
  bidVerifier: contract(203),
  allocationVerifier: contract(204),
  settlementVerifier: contract(205),
  feeWallet: contract(206),
  auditorId: 0,
  finalizationGraceLedgers: FINALIZATION_GRACE_LEDGERS,
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

let txCounter = 0;
const tx = (): TxResult => ({ hash: (++txCounter).toString(16).padStart(64, "0"), ledger: 0, events: [], cpuInsns: 0, feeCharged: 0n });

export function fakeBidRecord(p: Partial<BidRecord> & { bidder: string }): BidRecord {
  return {
    participantId: 0,
    commitment: 1n,
    nullifier: 2n,
    requestedQuantity: 200,
    envelope: { rPoint: { x: 1n, y: 2n }, ctPrice: 3n, ctBlinding: 4n, ctSeed: 5n },
    filledQuantity: 0,
    status: "Pending",
    ...p,
  };
}

export interface FakeAuctionOptions {
  log: CallLog;
  clock: Clock;
  params: MarketParams;
  seller: string;
  address?: string;
  marketId?: bigint;
  platform?: PlatformConfig;
  state?: MarketStatus;
  bids?: BidRecord[];

  token?: TokenPort;

  hasTrustline?: (account: string) => boolean;

  verifyProof?: (bid: BidSubmission) => boolean;

  commitmentsRoot?: Field;
}

export class FakeAuction implements AuctionPort {
  readonly address: string;
  readonly #o: FakeAuctionOptions;
  readonly #config: MarketConfig;
  #state: MarketStatus;
  readonly #bids: BidRecord[];
  readonly #participants = new Map<string, number>();
  readonly #nullifiers = new Set<Field>();
  readonly #fail = new Map<string, CmiErrorCode>();
  #configHash: Uint8Array | null = null;
  #finalizeBy: number | null = null;
  #root: Field | null = null;

  readonly #events: Promise<AuctionEvent>[] = [];

  constructor(o: FakeAuctionOptions) {
    this.#o = o;
    this.address = o.address ?? contract(77);
    this.#config = {
      marketId: o.marketId ?? 1n,
      seller: o.seller,
      params: o.params,
      platform: o.platform ?? FAKE_PLATFORM,

      finalizationGraceLedgers: (o.platform ?? FAKE_PLATFORM).finalizationGraceLedgers,
      feeBps: Number(FEE_BPS),
      auctionRule: 1,
      maxBids: MAX_BIDS,
    };
    this.#state = o.state ?? "Created";
    this.#bids = [...(o.bids ?? [])];
    for (const b of this.#bids) this.#participants.set(b.bidder, b.participantId);
    if (this.#state !== "Created") this.#configHash = configHash(this.#config);
    if (["Closed", "Finalized", "Settled"].includes(this.#state)) {
      this.#finalizeBy = o.params.closeLedger + this.#config.finalizationGraceLedgers;
      this.#freezeRoot();
    }
  }

  failNext(method: string, code: CmiErrorCode): void {
    this.#fail.set(method, code);
  }

  seedBid(record: BidRecord): void {
    if (!this.#participants.has(record.bidder)) this.addParticipant(record.bidder);
    this.#bids.push({ ...record, participantId: this.#participants.get(record.bidder)! });
    this.#nullifiers.add(record.nullifier);
    this.#emit({ kind: "BidAccepted", bidder: record.bidder, bidIndex: this.#bids.length - 1, requestedQuantity: record.requestedQuantity });
  }

  #emit(e: DistributiveOmit<AuctionEvent, "ledger">): void {
    this.#events.push(this.#o.clock.ledger().then((ledger) => ({ ...e, ledger }) as AuctionEvent));
  }

  async events(q: { startLedger: number }): Promise<AuctionEvent[]> {
    this.#call("events", false, [q.startLedger]);
    return (await Promise.all(this.#events)).filter((e) => e.ledger >= q.startLedger);
  }

  #maybeEnd(): void {
    if ((this.#state === "Finalized" || this.#state === "Cancelled") && this.#bids.length > 0 && this.#bids.every((x) => x.status !== "Pending")) {
      if (this.#state === "Finalized") this.#transition("Settled");
      this.#emit({ kind: "MarketSettled", marketId: this.#config.marketId });
    }
  }

  addParticipant(account: string): number {
    const id = this.#participants.size;
    this.#participants.set(account, id);
    this.#emit({ kind: "ParticipantRegistered", participant: account, participantId: id });
    return id;
  }

  #call(method: string, write: boolean, args: readonly unknown[] = []): void {
    this.#o.log.record(`auction.${method}`, write, args);
    const code = this.#fail.get(method);
    if (code !== undefined) {
      this.#fail.delete(method);
      throw contractError(code, `${method}: injected`);
    }
  }

  #transition(to: MarketStatus): void {
    if (!MARKET_TRANSITIONS.some(([a, b]) => a === this.#state && b === to)) throw new CmiError("Auction.InvalidState", "illegal transition");
    this.#state = to;
  }

  #requireSeller(s: Signer): void {
    if (s.address !== this.#config.seller) throw new CmiError("TxFailed", "auth: not the seller");
  }

  async getMarket(): Promise<MarketConfig> {
    this.#call("get_market", false);
    return this.#config;
  }

  async getState(): Promise<MarketStatus> {
    this.#call("get_state", false);
    return this.#state;
  }

  async getParticipantId(a: string): Promise<number | null> {
    this.#call("get_participant_id", false, [a]);
    return this.#participants.get(a) ?? null;
  }

  async getParticipant(id: number): Promise<string | null> {
    this.#call("get_participant", false, [id]);
    return [...this.#participants].find(([, v]) => v === id)?.[0] ?? null;
  }

  async getBidCount(): Promise<number> {
    this.#call("get_bid_count", false);
    return this.#bids.length;
  }

  async getBidRecord(i: number): Promise<BidRecord> {
    this.#call("get_bid_record", false, [i]);
    const b = this.#bids[i];
    if (b === undefined) throw new CmiError("Auction.BidNotFound", "no such bid");
    return b;
  }

  async getAllocation(): Promise<number[]> {
    this.#call("get_allocation", false);
    return this.#state === "Finalized" || this.#state === "Settled" ? this.#bids.map((b) => b.filledQuantity) : [];
  }

  async getConfigHash(): Promise<Uint8Array | null> {
    this.#call("get_config_hash", false);
    return this.#configHash;
  }

  async getCommitmentsRoot(): Promise<Field | null> {
    this.#call("get_commitments_root", false);
    return this.#root;
  }

  #freezeRoot(): void {
    this.#root = this.#o.commitmentsRoot ?? commitmentsRoot(this.#bids.map((b) => b.commitment));
  }

  async getFinalizeByLedger(): Promise<number | null> {
    this.#call("get_finalize_by_ledger", false);
    return this.#finalizeBy;
  }

  async getSettlementStatus(i: number): Promise<BidStatus> {
    this.#call("get_settlement_status", false, [i]);
    return (await this.getBidRecord(i)).status;
  }

  async hasNullifier(n: Field): Promise<boolean> {
    this.#call("has_nullifier", false, [n]);
    return this.#nullifiers.has(n);
  }

  async getFeeReserve(): Promise<bigint> {
    this.#call("get_fee_reserve", false);
    return this.#config.params.feeReserve;
  }

  async openMarket(seller: Signer): Promise<TxResult> {
    this.#call("open_market", true);
    this.#requireSeller(seller);
    this.#transition("Open");
    const hash = configHash(this.#config);
    this.#configHash = hash;
    this.#emit({ kind: "MarketOpened", marketId: this.#config.marketId, configHash: hash, totalQuotas: this.#config.params.totalQuotas });
    return tx();
  }

  async cancelMarket(seller: Signer): Promise<TxResult> {
    this.#call("cancel_market", true);
    this.#requireSeller(seller);
    if (this.#state === "Open" && this.#bids.length > 0) throw new CmiError("Auction.HasBids", "market has bids");
    this.#transition("Cancelled");
    this.#emit({ kind: "MarketCancelled", marketId: this.#config.marketId, reason: "seller" });
    return tx();
  }

  async registerParticipant(p: Signer): Promise<number> {
    this.#call("register_participant", true, [p.address]);
    if (this.#state !== "Open") throw new CmiError("Auction.InvalidState", "not open");
    if (this.#participants.has(p.address)) throw new CmiError("Auction.AlreadyRegistered", "already registered");
    return this.addParticipant(p.address);
  }

  async submitBid(bidder: Signer, bid: BidSubmission): Promise<number> {
    this.#call("submit_bid", true, [bidder.address, bid]);
    const fail = (code: CmiErrorCode): never => {
      throw new CmiError(code, "submit_bid rejected");
    };
    if (this.#state !== "Open") fail("Auction.InvalidState");
    if ((await this.#o.clock.ledger()) >= this.#config.params.closeLedger) fail("Auction.BiddingClosed");
    if (this.#bids.length >= MAX_BIDS) fail("Auction.MarketFull");
    const participantId = this.#participants.get(bidder.address);
    if (participantId === undefined) return fail("Auction.NotRegistered");
    if (this.#bids.some((b) => b.bidder === bidder.address)) fail("Auction.AlreadyBid");
    if (bid.requestedQuantity === 0) fail("Auction.ZeroQuantity");
    if (this.#nullifiers.has(bid.nullifier)) fail("Auction.NullifierUsed");
    if (!(this.#o.hasTrustline?.(bidder.address) ?? true)) fail("Auction.NoTrustline");
    const token = this.#o.token;
    if (token !== undefined) {
      if (!(await token.isSpender(bidder.address, this.address))) fail("Auction.NoCollateral");
      const d = await token.delegation(bidder.address, this.address);
      const required = this.#config.params.closeLedger + this.#config.finalizationGraceLedgers + SETTLEMENT_MARGIN_LEDGERS;
      if (d === null || d.liveUntilLedger < required) fail("Auction.CollateralExpiresTooSoon");
    }
    if (!(this.#o.verifyProof?.(bid) ?? true)) fail("Auction.InvalidBidProof");
    const bidIndex = this.#bids.length;
    this.#bids.push(fakeBidRecord({ ...bid, bidder: bidder.address, participantId }));
    this.#nullifiers.add(bid.nullifier);
    this.#emit({ kind: "BidAccepted", bidder: bidder.address, bidIndex, requestedQuantity: bid.requestedQuantity });
    return bidIndex;
  }

  async closeMarket(_caller: Signer): Promise<TxResult> {
    this.#call("close_market", true);
    if (this.#state !== "Open") throw new CmiError("Auction.InvalidState", "not open");
    const ledger = await this.#o.clock.ledger();
    if (ledger < this.#config.params.closeLedger) throw new CmiError("Auction.TooEarly", "before close_ledger");
    if (this.#bids.length === 0) {
      this.#transition("Cancelled");
      this.#emit({ kind: "MarketCancelled", marketId: this.#config.marketId, reason: "no_bids" });
    } else {
      this.#transition("Closed");
      this.#finalizeBy = this.#config.params.closeLedger + this.#config.finalizationGraceLedgers;
      this.#freezeRoot();
      this.#emit({ kind: "MarketClosed", marketId: this.#config.marketId, bidCount: this.#bids.length, commitmentsRoot: this.#root!, finalizeByLedger: this.#finalizeBy });
    }
    return tx();
  }

  async finalize(_caller: Signer, filled: number[], _proof: Uint8Array): Promise<TxResult> {
    this.#call("finalize", true, [filled]);
    if (this.#state === "Closed" && (await this.#o.clock.ledger()) > (this.#finalizeBy ?? 0)) throw new CmiError("Auction.TooLate", "after finalize_by");
    this.#transition("Finalized");
    filled.forEach((f, i) => {
      const b = this.#bids[i];
      if (b !== undefined) b.filledQuantity = f;
    });
    this.#emit({ kind: "MarketFinalized", marketId: this.#config.marketId, filled: [...filled], unsold: this.#config.params.totalQuotas - filled.reduce((s, f) => s + f, 0) });
    return tx();
  }

  async cancelExpired(_caller: Signer): Promise<TxResult> {
    this.#call("cancel_expired", true);
    if (this.#state === "Closed" && (await this.#o.clock.ledger()) <= (this.#finalizeBy ?? 0)) throw new CmiError("Auction.TooEarly", "before finalize_by");
    this.#transition("Cancelled");
    this.#emit({ kind: "MarketCancelled", marketId: this.#config.marketId, reason: "timeout" });
    return tx();
  }

  async settle(_caller: Signer, bidIndex: number, _legs: unknown, _proof: Uint8Array): Promise<SettleOutcome> {
    this.#call("settle", true, [bidIndex]);
    const b = this.#bids[bidIndex];
    if (b === undefined) throw new CmiError("Auction.BidNotFound", "no such bid");

    if (b.status === "Settled") return "AlreadySettled";
    if (b.status === "Failed") throw new CmiError("Auction.BidAlreadyClosed", "bid failed");
    if (this.#state !== "Finalized" && this.#state !== "Cancelled") throw new CmiError("Auction.InvalidState", "not finalized");

    const token = this.#o.token;
    if (token !== undefined) {
      const me = { address: this.address } as Signer;
      const legs = _legs as SettlementLegs;
      await token.spenderTransfer(me, b.bidder, this.#config.seller, legs.sellerData);
      await token.spenderTransfer(me, b.bidder, this.#config.platform.feeWallet, legs.feeData);
      await token.spenderTransfer(me, b.bidder, b.bidder, legs.refundData);
    }
    b.status = "Settled";
    this.#emit({ kind: "BidSettled", bidder: b.bidder, bidIndex, filledQuantity: this.#state === "Cancelled" ? 0 : b.filledQuantity });

    this.#maybeEnd();
    return "Settled";
  }

  async releaseUnsettled(_caller: Signer, bidIndex: number): Promise<TxResult> {
    this.#call("release_unsettled", true, [bidIndex]);
    const b = this.#bids[bidIndex];
    if (b === undefined) throw new CmiError("Auction.BidNotFound", "no such bid");

    if (b.status !== "Pending") throw new CmiError("Auction.BidAlreadyClosed", "bid closed");
    if (this.#state !== "Finalized" && this.#state !== "Cancelled") throw new CmiError("Auction.InvalidState", "not finalized");
    if (this.#o.token !== undefined && (await this.#o.token.isSpender(b.bidder, this.address))) {
      throw new CmiError("Auction.DelegationStillActive", "delegation still active");
    }
    b.status = "Failed";
    this.#emit({ kind: "BidFailed", bidder: b.bidder, bidIndex, filledQuantity: b.filledQuantity });
    this.#maybeEnd();
    return tx();
  }
}
