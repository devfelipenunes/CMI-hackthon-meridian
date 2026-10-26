import { Address, Contract, Keypair, Networks, StrKey, contract, nativeToScVal, xdr, type Transaction, type rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  ChainClient,
  GRUMPKIN_G,
  chainAuctionPort,
  chainFactoryPort,
  keypairSigner,
  pointToBytes,
  scalarMul,
  toBytes32BE,
  type BidSubmission,
  type MarketParams,
} from "../../src/index.js";
import { AUCTION_SPEC } from "../../src/bindings/auction.js";
import { FakeRpc, contractErrorEvent } from "../helpers/rpc.js";

const AUCTION = StrKey.encodeContract(Buffer.alloc(32, 7));
const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 8));
const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
const BIDDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const spec = new contract.Spec([...AUCTION_SPEC]);
const udt = (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
const R = scalarMul(123_456_789_012n, GRUMPKIN_G);

function setup(rpc = new FakeRpc()) {
  const chain = new ChainClient({ rpcUrl: "http://x", networkPassphrase: Networks.STANDALONE, server: rpc, pollIntervalMs: 0 });
  return { rpc, auction: chainAuctionPort({ chain, address: AUCTION }), factory: chainFactoryPort({ chain, address: FACTORY }) };
}

function call(tx: Transaction): { contract: string; fn: string; args: xdr.ScVal[] } {
  const ic = (tx.operations[0] as unknown as { func: xdr.HostFunction }).func.invokeContract();
  return { contract: Address.fromScAddress(ic.contractAddress()).toString(), fn: ic.functionName().toString(), args: ic.args() };
}

const envelopeNative = {
  r_point: Buffer.from(pointToBytes(R)),
  ct_price: Buffer.from(toBytes32BE(11n)),
  ct_blinding: Buffer.from(toBytes32BE(12n)),
  ct_seed: Buffer.from(toBytes32BE(13n)),
};

const config = {
  market_id: 42n,
  seller: BIDDER.publicKey(),
  params: { quota_asset: QUOTA, total_quotas: 1000, min_price_per_quota: 500n, close_ledger: 9_000, eligibility_policy: undefined, fee_reserve: 50_000_000n },
  platform: {
    collateral_token: QUOTA, fee_asset: QUOTA, bid_verifier: QUOTA, allocation_verifier: QUOTA, settlement_verifier: QUOTA,
    fee_wallet: BIDDER.publicKey(), auditor_id: 0, finalization_grace_ledgers: 30,
  },
  finalization_grace_ledgers: 34_560, fee_bps: 1_000, auction_rule: 1, max_bids: 8,
};

describe("AuctionPort (adaptador real, spec do WASM fixado)", () => {
  it("AuctionPort.getBidRecord decodes envelope points", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({
      retval: spec.nativeToScVal(
        {
          bidder: BIDDER.publicKey(), participant_id: 3, commitment: Buffer.from(toBytes32BE(21n)), nullifier: Buffer.from(toBytes32BE(22n)),
          requested_quantity: 200, envelope: envelopeNative, filled_quantity: 0, status: { tag: "Pending" },
        },
        udt("BidRecord"),
      ),
    });
    const { auction } = setup(rpc);

    expect(await auction.getBidRecord(0)).toEqual({
      bidder: BIDDER.publicKey(), participantId: 3, commitment: 21n, nullifier: 22n, requestedQuantity: 200,
      envelope: { rPoint: R, ctPrice: 11n, ctBlinding: 12n, ctSeed: 13n }, filledQuantity: 0, status: "Pending",
    });
    const c = call(rpc.simulated[0]!);
    expect([c.contract, c.fn, c.args[0]!.u32()]).toEqual([AUCTION, "get_bid_record", 0]);
  });

  it("getMarket decodes MarketConfig into the core type", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: spec.nativeToScVal(config, udt("MarketConfig")) });
    const m = await setup(rpc).auction.getMarket();
    expect(m).toMatchObject({ marketId: 42n, seller: BIDDER.publicKey(), finalizationGraceLedgers: 34_560, feeBps: 1_000, maxBids: 8 });
    expect(m.params).toEqual({ quotaAsset: QUOTA, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: 9_000, eligibilityPolicy: null, feeReserve: 50_000_000n });
    expect(m.platform.feeWallet).toBe(BIDDER.publicKey());
    expect(m.platform.finalizationGraceLedgers).toBe(30);
  });

  it.each(["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"])("getState decodes %s", async (s) => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(s)]) });
    expect(await setup(rpc).auction.getState()).toBe(s);
  });

  it("getParticipantId and getConfigHash map Option::None to null", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: xdr.ScVal.scvVoid() });
    const { auction } = setup(rpc);
    expect(await auction.getParticipantId(BIDDER.publicKey())).toBeNull();
    expect(await auction.getConfigHash()).toBeNull();
  });

  it("submitBid sends (bidder, BidSubmission) and returns the bid_index", async () => {
    const rpc = new FakeRpc();
    rpc.transactions = [FakeRpc.txSuccess({ retval: xdr.ScVal.scvU32(4) })];
    const { auction } = setup(rpc);
    const bid: BidSubmission = {
      requestedQuantity: 200, commitment: 21n, nullifier: 22n,
      envelope: { rPoint: R, ctPrice: 11n, ctBlinding: 12n, ctSeed: 13n }, proof: new Uint8Array([1, 2, 3]),
    };

    expect(await auction.submitBid(keypairSigner(BIDDER.secret()), bid)).toBe(4);
    const c = call(rpc.sent[0]!);
    expect(c.fn).toBe("submit_bid");
    expect(Address.fromScVal(c.args[0]!).toString()).toBe(BIDDER.publicKey());
    const sent = spec.scValToNative(c.args[1]!, udt("BidSubmission")) as Record<string, unknown> & { envelope: Record<string, Uint8Array> };
    expect(sent.requested_quantity).toBe(200);
    expect(Buffer.from(sent.commitment as Uint8Array)).toEqual(Buffer.from(toBytes32BE(21n)));
    expect(Buffer.from(sent.envelope.r_point!)).toEqual(Buffer.from(pointToBytes(R)));
    expect([...(sent.proof as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it("registerParticipant returns the participant_id", async () => {
    const rpc = new FakeRpc();
    rpc.transactions = [FakeRpc.txSuccess({ retval: xdr.ScVal.scvU32(2) })];
    expect(await setup(rpc).auction.registerParticipant(keypairSigner(BIDDER.secret()))).toBe(2);
    expect(Address.fromScVal(call(rpc.sent[0]!).args[0]!).toString()).toBe(BIDDER.publicKey());
  });

  it("openMarket and cancelMarket take no arguments", async () => {
    const { rpc, auction } = setup();
    await auction.openMarket(keypairSigner(BIDDER.secret()));
    expect([call(rpc.sent[0]!).fn, call(rpc.sent[0]!).args]).toEqual(["open_market", []]);
  });

  it("contract errors come back as Auction.*", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #14)", [contractErrorEvent(AUCTION, 14)]);
    await expect(setup(rpc).auction.cancelMarket(keypairSigner(BIDDER.secret()))).rejects.toMatchObject({ code: "Auction.HasBids" });
  });

  it("settle decodes SettleOutcome (AlreadySettled is success, D-09)", async () => {
    const rpc = new FakeRpc();
    rpc.transactions = [FakeRpc.txSuccess({ retval: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("AlreadySettled")]) })];
    const legs = { sellerData: new Uint8Array([1]), feeData: new Uint8Array([2]), refundData: new Uint8Array([3]) };
    expect(await setup(rpc).auction.settle(keypairSigner(BIDDER.secret()), 1, legs, new Uint8Array([4]))).toBe("AlreadySettled");
    const c = call(rpc.sent[0]!);
    expect([c.fn, c.args[1]!.u32(), c.args.length]).toEqual(["settle", 1, 6]);
  });

  it("finalize sends (caller, Vec<u32>, proof)", async () => {
    const { rpc, auction } = setup();
    await auction.finalize(keypairSigner(BIDDER.secret()), [200, 0], new Uint8Array([9]));
    const c = call(rpc.sent[0]!);
    expect([c.fn, c.args[1]!.vec()!.map((v) => v.u32())]).toEqual(["finalize", [200, 0]]);
  });
});

describe("FactoryPort (adaptador real)", () => {
  const params: MarketParams = {
    quotaAsset: QUOTA, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: 9_000, eligibilityPolicy: null, feeReserve: 50_000_000n,
  };

  it("createMarket sends (seller, MarketParams, register_data) and returns (market_id, address)", async () => {
    const rpc = new FakeRpc();
    rpc.transactions = [FakeRpc.txSuccess({ retval: xdr.ScVal.scvVec([nativeToScVal(5n, { type: "u64" }), new Address(AUCTION).toScVal()]) })];
    const { factory } = setup(rpc);

    expect(await factory.createMarket(keypairSigner(BIDDER.secret()), params, new Uint8Array([7]))).toEqual({ marketId: 5n, address: AUCTION });
    const c = call(rpc.sent[0]!);
    expect([c.contract, c.fn]).toEqual([FACTORY, "create_market"]);
    const p = c.args[1]!.map()!.map((e) => e.key().sym().toString());
    expect(p).toEqual(["close_ledger", "eligibility_policy", "fee_reserve", "min_price_per_quota", "quota_asset", "total_quotas"]);
    expect([...c.args[2]!.bytes()]).toEqual([7]);
  });

  it("nextMarketId and predictMarketAddress decode u64 and Address", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: nativeToScVal(7n, { type: "u64" }) });
    const { factory } = setup(rpc);
    expect(await factory.nextMarketId()).toBe(7n);
    rpc.simulation = FakeRpc.simSuccess({ retval: new Address(AUCTION).toScVal() });
    expect(await factory.predictMarketAddress(7n)).toBe(AUCTION);
    expect(call(rpc.simulated[1]!).args[0]!.u64().toString()).toBe("7");
  });

  it("getMarketAddress of an unknown id is Factory.MarketNotFound", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #1)");
    await expect(setup(rpc).factory.getMarketAddress(99n)).rejects.toMatchObject({ code: "Factory.MarketNotFound" });
  });
});

describe("AuctionPort: eventos (passo 6.1, RF-22)", () => {
  const sym = (s: string) => xdr.ScVal.scvSymbol(s);
  const u32 = (n: number) => xdr.ScVal.scvU32(n);
  const u64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
  const map = (o: Record<string, xdr.ScVal>) =>
    xdr.ScVal.scvMap(Object.keys(o).sort().map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k]! })));
  const ev = (ledger: number, topic: xdr.ScVal[], value: xdr.ScVal) =>
    ({ id: `${ledger}`, type: "contract", ledger, ledgerClosedAt: "", contractId: new Contract(AUCTION), topic, value, txHash: "", inSuccessfulContractCall: true, pagingToken: "" }) as unknown as rpc.Api.EventResponse;
  const bidder = new Address(BIDDER.publicKey()).toScVal();
  const hash = xdr.ScVal.scvBytes(Buffer.alloc(32, 5));

  it("events decodes the nine Auction events, without any price", async () => {
    const rpc = new FakeRpc();
    rpc.eventPages = [[
      ev(10, [sym("market_opened"), u64(6n)], map({ config_hash: hash, total_quotas: u32(1000) })),
      ev(11, [sym("participant_registered"), bidder], map({ participant_id: u32(0) })),
      ev(12, [sym("bid_accepted"), bidder], map({ bid_index: u32(0), requested_quantity: u32(200) })),
      ev(20, [sym("market_closed"), u64(6n)], map({ bid_count: u32(1), commitments_root: hash, finalize_by_ledger: u32(17_300) })),
      ev(21, [sym("market_finalized"), u64(6n)], map({ filled_quantities: xdr.ScVal.scvVec([u32(200)]), unsold: u32(800) })),
      ev(22, [sym("bid_settled"), bidder], map({ bid_index: u32(0), filled_quantity: u32(200) })),
      ev(23, [sym("bid_failed"), bidder], map({ bid_index: u32(1), filled_quantity: u32(0) })),
      ev(23, [sym("market_settled"), u64(6n)], map({})),
      ev(30, [sym("market_cancelled"), u64(7n)], map({ reason: sym("timeout") })),
    ]];
    const got = await setup(rpc).auction.events({ startLedger: 5 });
    const b = BIDDER.publicKey();
    expect(got).toEqual([
      { kind: "MarketOpened", ledger: 10, marketId: 6n, configHash: new Uint8Array(32).fill(5), totalQuotas: 1000 },
      { kind: "ParticipantRegistered", ledger: 11, participant: b, participantId: 0 },
      { kind: "BidAccepted", ledger: 12, bidder: b, bidIndex: 0, requestedQuantity: 200 },
      { kind: "MarketClosed", ledger: 20, marketId: 6n, bidCount: 1, commitmentsRoot: BigInt(`0x${"05".repeat(32)}`), finalizeByLedger: 17_300 },
      { kind: "MarketFinalized", ledger: 21, marketId: 6n, filled: [200], unsold: 800 },
      { kind: "BidSettled", ledger: 22, bidder: b, bidIndex: 0, filledQuantity: 200 },
      { kind: "BidFailed", ledger: 23, bidder: b, bidIndex: 1, filledQuantity: 0 },
      { kind: "MarketSettled", ledger: 23, marketId: 6n },
      { kind: "MarketCancelled", ledger: 30, marketId: 7n, reason: "timeout" },
    ]);
    expect(rpc.calls).toContain("getEvents:start=5");
  });
});
