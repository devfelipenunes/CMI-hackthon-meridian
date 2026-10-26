import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { FakeRpc, contractErrorEvent, contractEvent } from "../helpers/rpc.js";
import { describe, expect, it } from "vitest";

import { ChainClient, CmiError, EVENT_WINDOW_MARGIN_LEDGERS, keypairSigner, walletSigner, type WalletAdapter } from "../../src/index.js";

const CONTRACTS = fileURLToPath(new URL("../../../../contracts/", import.meta.url));
const AUCTION = StrKey.encodeContract(Buffer.alloc(32, 7));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 9));
const BIDDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));

function client(rpc = new FakeRpc()): { chain: ChainClient; rpc: FakeRpc } {
  const chain = new ChainClient({
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: Networks.STANDALONE,
    server: rpc,
    pollIntervalMs: 0,
  });
  return { chain, rpc };
}

function auctionErrors(): [number, string][] {
  return [
    [1, "InvalidTotalQuotas"], [2, "InvalidMinPrice"], [3, "InvalidCloseLedger"],
    [4, "DurationTooLong"], [5, "InvalidFeeReserve"], [10, "InvalidState"],
    [11, "TooEarly"], [12, "TooLate"], [13, "BiddingClosed"], [14, "HasBids"],
    [20, "AlreadyRegistered"], [21, "NotRegistered"], [22, "NotEligible"],
    [30, "MarketFull"], [31, "AlreadyBid"], [32, "ZeroQuantity"],
    [33, "NullifierUsed"], [34, "NoTrustline"], [35, "NoCollateral"],
    [36, "CollateralExpiresTooSoon"], [37, "InvalidBidProof"],
    [40, "InvalidAllocationLength"], [41, "FillExceedsRequest"], [42, "InvalidAllocationProof"],
    [50, "BidNotFound"], [51, "InvalidTransferData"], [52, "InvalidSettlementProof"],
    [53, "DelegationStillActive"], [54, "BidAlreadyClosed"],
  ];
}

function factoryErrors(): [number, string][] {
  const src = readFileSync(`${CONTRACTS}contracts/factory/src/lib.rs`, "utf8");
  const body = src.slice(src.indexOf("pub enum FactoryError"), src.indexOf("}", src.indexOf("pub enum FactoryError")));
  return [...body.matchAll(/^\s*(\w+)\s*=\s*(\d+),/gm)].map((m) => [Number(m[2]), m[1]!]);
}

describe("ChainClient.invoke", () => {
  it("invoke simulates, assembles, signs and polls until success", async () => {
    const { chain, rpc } = client();
    const signed: string[] = [];
    const signer = keypairSigner(BIDDER.secret());
    const spy = { ...signer, signTransaction: async (x: string, o: { networkPassphrase: string }) => (signed.push(x), signer.signTransaction(x, o)) };

    await chain.invoke(AUCTION, "register_participant", [], spy);

    expect(rpc.calls).toEqual(["getNetwork", "getAccount", "simulateTransaction", "sendTransaction", "getTransaction", "getTransaction"]);
    expect(signed).toHaveLength(1);

    const sent = rpc.sent[0]!;
    expect(sent.toEnvelope().v1().tx().ext().switch()).toBe(1);
    expect(sent.signatures).toHaveLength(1);
    expect(BIDDER.verify(sent.hash(), sent.signatures[0]!.signature())).toBe(true);
  });

  it("invoke returns hash, ledger, events and cpu", async () => {
    const rpc = new FakeRpc();
    const ev = contractEvent(AUCTION, [xdr.ScVal.scvSymbol("bid_accepted")], xdr.ScVal.scvU32(3));
    rpc.simulation = FakeRpc.simSuccess({ cpu: 82_441_222 });
    rpc.transactions = [FakeRpc.txSuccess({ ledger: 4242, fee: 123_456n, events: [ev], retval: xdr.ScVal.scvU32(3) })];
    const { chain } = client(rpc);

    const r = await chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()));

    expect(r.hash).toBe(rpc.sent[0]!.hash().toString("hex"));
    expect(r.ledger).toBe(4242);
    expect(r.cpuInsns).toBe(82_441_222);
    expect(r.feeCharged).toBe(123_456n);
    expect(r.returnValue?.u32()).toBe(3);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.contractId).toBe(AUCTION);
    expect(r.events[0]!.topics[0]!.sym().toString()).toBe("bid_accepted");
    expect(r.events[0]!.data.u32()).toBe(3);
  });

  it("invoke retries getAccount while a fresh account is not yet visible to the RPC", async () => {
    const rpc = new FakeRpc();
    rpc.accountMisses = 2;
    const { chain } = client(rpc);

    await chain.invoke(AUCTION, "register_participant", [], keypairSigner(BIDDER.secret()));

    expect(rpc.calls.filter((c) => c === "getAccount")).toHaveLength(3);
    expect(rpc.sent).toHaveLength(1);
  });

  it("invoke gives up on a missing account after maxPolls reads, sending nothing", async () => {
    const rpc = new FakeRpc();
    rpc.accountMisses = Number.MAX_SAFE_INTEGER;
    const chain = new ChainClient({ rpcUrl: "http://x", networkPassphrase: Networks.STANDALONE, server: rpc, pollIntervalMs: 0, maxPolls: 5 });

    await expect(chain.invoke(AUCTION, "register_participant", [], keypairSigner(BIDDER.secret()))).rejects.toThrow(/Account not found/);

    expect(rpc.calls.filter((c) => c === "getAccount")).toHaveLength(5);
    expect(rpc.sent).toHaveLength(0);
  });

  it("invoke does not retry other getAccount errors", async () => {
    const rpc = new FakeRpc();
    rpc.accountError = new Error("connect ECONNREFUSED");
    const { chain } = client(rpc);

    await expect(chain.invoke(AUCTION, "register_participant", [], keypairSigner(BIDDER.secret()))).rejects.toThrow(/ECONNREFUSED/);

    expect(rpc.calls.filter((c) => c === "getAccount")).toHaveLength(1);
  });

  it("simulate returns the retval without signing or sending", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: xdr.ScVal.scvU64(xdr.Uint64.fromString("7")) });
    const { chain } = client(rpc);

    const v = await chain.simulate(AUCTION, "next_market_id", []);

    expect(v.u64().toString()).toBe("7");
    expect(rpc.calls).toEqual(["getNetwork", "simulateTransaction"]);
  });

  it("latestLedger reads the RPC", async () => {
    const rpc = new FakeRpc();
    rpc.latestLedger = 777;
    expect(await client(rpc).chain.latestLedger()).toBe(777);
  });
});

describe("ChainClient: erros tipados (S-15)", () => {
  const auction = auctionErrors();
  const factory = factoryErrors();

  it("the error tables cover every code of AuctionError", () => {
    expect(auction.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 20, 21, 22, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 50, 51, 52, 53, 54]);
    expect(factory.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each(auction)("contract error #%i maps to Auction.%s (simulation)", async (n, name) => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError(`HostError: Error(Contract, #${n})`);
    const { chain } = client(rpc);
    await expect(chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()), { errors: "Auction" })).rejects.toMatchObject({
      code: `Auction.${name}`,
    });
    expect(rpc.calls).not.toContain("sendTransaction");
  });

  it.each(factory)("contract error #%i maps to Factory.%s", async (n, name) => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError(`HostError: Error(Contract, #${n})`);
    await expect(client(rpc).chain.simulate(AUCTION, "get_market_address", [], { errors: "Factory" })).rejects.toMatchObject({
      code: `Factory.${name}`,
    });
  });

  it("contract error #37 maps to Auction.InvalidBidProof when the tx fails on-chain", async () => {
    const rpc = new FakeRpc();
    rpc.transactions = [FakeRpc.txFailed({ diagnostics: [contractErrorEvent(AUCTION, 37)] })];
    const err = await client(rpc).chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()), { errors: "Auction" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CmiError);
    expect(err).toMatchObject({ code: "Auction.InvalidBidProof" });
  });

  it("a sub-call error the contract caught does not mask the contract's own error (the last error event wins)", async () => {

    const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 11));
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #37)", [contractErrorEvent(VERIFIER, 3), contractErrorEvent(AUCTION, 37)]);
    await expect(client(rpc).chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()), { errors: "Auction" })).rejects.toMatchObject({
      code: "Auction.InvalidBidProof",
    });
    const onChain = new FakeRpc();
    onChain.transactions = [FakeRpc.txFailed({ diagnostics: [contractErrorEvent(VERIFIER, 3), contractErrorEvent(AUCTION, 37)] })];
    await expect(client(onChain).chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()), { errors: "Auction" })).rejects.toMatchObject({
      code: "Auction.InvalidBidProof",
    });
  });

  it("token DelegationAlreadyExists maps to Token.DelegationAlreadyExists", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3503)", [contractErrorEvent(TOKEN, 3503)]);
    await expect(client(rpc).chain.invoke(TOKEN, "set_spender", [], keypairSigner(BIDDER.secret()))).rejects.toMatchObject({
      code: "Token.DelegationAlreadyExists",
    });
  });

  it("a token error raised inside an Auction call keeps the Token prefix", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3505)");
    await expect(client(rpc).chain.invoke(AUCTION, "settle", [], keypairSigner(BIDDER.secret()), { errors: "Auction" })).rejects.toMatchObject({
      code: "Token.DelegationExpired",
    });
  });

  it("a contract code without a known domain is TxFailed, not a guess", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #37)");
    await expect(client(rpc).chain.simulate(AUCTION, "x", [])).rejects.toMatchObject({ code: "TxFailed" });
  });

  it.each([
    ["send TRY_AGAIN_LATER", (rpc: FakeRpc) => void (rpc.sendStatus = "TRY_AGAIN_LATER")],
    ["on-chain resource limit exceeded", (rpc: FakeRpc) => void (rpc.transactions = [FakeRpc.txFailed({ result: FakeRpc.resourceLimitExceeded() })])],
  ])("resource exhaustion maps to ResourceContention with retry_next_ledger (%s)", async (_case, setup) => {
    const rpc = new FakeRpc();
    setup(rpc);
    await expect(client(rpc).chain.invoke(AUCTION, "settle", [], keypairSigner(BIDDER.secret()), { errors: "Auction" })).rejects.toMatchObject({
      code: "ResourceContention",
      recovery: "retry_next_ledger",
    });
  });

  it("NetworkMismatch when passphrase differs from deployment", async () => {
    const rpc = new FakeRpc();
    rpc.passphrase = Networks.TESTNET;
    const { chain } = client(rpc);
    await expect(chain.invoke(AUCTION, "submit_bid", [], keypairSigner(BIDDER.secret()))).rejects.toMatchObject({ code: "NetworkMismatch" });
    await expect(chain.simulate(AUCTION, "get_state", [])).rejects.toMatchObject({ code: "NetworkMismatch" });
    expect(rpc.calls.filter((c) => c !== "getNetwork")).toEqual([]);
  });

  it("CmiError message never contains raw ScVal bytes of args", async () => {
    const price = 650_000_000_123n;
    const arg = nativeToScVal(price, { type: "u64" });
    const blob = xdr.ScVal.scvBytes(Buffer.from("c0ffee1234567890".repeat(4), "hex"));
    const rpc = new FakeRpc();

    rpc.simulation = FakeRpc.simError(
      `HostError: Error(Contract, #37)\n\nEvent log (newest first):\n   0: [Diagnostic Event] topics:[fn_call, ${AUCTION}, submit_bid], data:[${price}, ${arg.toXDR("hex")}, ${blob.toXDR("base64")}]`,
    );
    const err = await client(rpc).chain.invoke(AUCTION, "submit_bid", [arg, blob], keypairSigner(BIDDER.secret()), { errors: "Auction" }).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: "Auction.InvalidBidProof" });

    const e = err as CmiError;
    const sink = [e.message, e.stack ?? "", JSON.stringify(e.cause ?? null), JSON.stringify({ ...e })].join("\n").toLowerCase();
    for (const needle of [
      price.toString(),
      price.toString(16),
      price.toString(16).padStart(64, "0"),
      arg.toXDR("hex"),
      blob.toXDR("base64").toLowerCase(),
      Buffer.from(blob.bytes()).toString("hex"),
    ]) {
      expect(sink).not.toContain(needle);
    }
  });
});

describe("ChainClient.events", () => {
  it("pages through getEvents until a short page", async () => {
    const rpc = new FakeRpc();
    const ev = (id: string): import("@stellar/stellar-sdk").rpc.Api.EventResponse => ({
      id, type: "contract", ledger: 10, ledgerClosedAt: "", transactionIndex: 0, operationIndex: 0,
      inSuccessfulContractCall: true, txHash: "ab", topic: [xdr.ScVal.scvSymbol("market_opened")], value: xdr.ScVal.scvVoid(),
    });
    rpc.eventPages = [[ev("1"), ev("2")], [ev("3")]];
    const { chain } = client(rpc);

    const seen: string[] = [];
    for await (const e of chain.events({ contractIds: [AUCTION], startLedger: 5, pageSize: 2 })) seen.push(e.id!);

    expect(seen).toEqual(["1", "2", "3"]);
    expect(rpc.calls.filter((c) => c.startsWith("getEvents"))).toEqual(["getEvents:start=5", "getEvents:2"]);
  });

  it("keeps paging through short pages while the cursor is behind the latest ledger (RPC scans ~10.000 ledgers per call)", async () => {

    const toid = (ledger: number): string => `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-4294967295`;
    const rpc = new FakeRpc();
    rpc.latestLedger = 30_500;
    const ev = (id: string, ledger: number): import("@stellar/stellar-sdk").rpc.Api.EventResponse => ({
      id, type: "contract", ledger, ledgerClosedAt: "", transactionIndex: 0, operationIndex: 0,
      inSuccessfulContractCall: true, txHash: "ab", topic: [xdr.ScVal.scvSymbol("deposit")], value: xdr.ScVal.scvVoid(),
    });
    rpc.eventPages = [[], [ev("a", 15_000)], [], [ev("b", 30_400)]];
    rpc.eventCursors = [toid(10_000), toid(20_000), toid(30_000), toid(30_500)];
    const { chain } = client(rpc);

    const seen: string[] = [];
    for await (const e of chain.events({ contractIds: [TOKEN], startLedger: 5 })) seen.push(e.id!);

    expect(seen).toEqual(["a", "b"]);
    expect(rpc.calls.filter((c) => c.startsWith("getEvents"))).toHaveLength(4);
  });

  it("splits more than 5 topic patterns into several filters of the same request (RPC limit)", async () => {
    const rpc = new FakeRpc();
    const { chain } = client(rpc);
    const topics = Array.from({ length: 9 }, (_, i) => [`t${i}`]);
    for await (const _ of chain.events({ contractIds: [TOKEN], topics, startLedger: 5 })) void _;
    const filters = rpc.eventRequests[0]!.filters;
    expect(filters.map((f) => f.topics)).toEqual([topics.slice(0, 5), topics.slice(5)]);
    expect(filters.every((f) => f.contractIds?.[0] === TOKEN)).toBe(true);
  });
});

describe("ChainClient: janela de eventos do RPC (S-23, passo 7.3)", () => {
  it("events starts at the retention floor plus the margin when asked for older ledgers", async () => {

    const rpc = new FakeRpc();
    rpc.oldestLedger = 50_000;
    rpc.latestLedger = 60_000;
    for await (const _ of client(rpc).chain.events({ contractIds: [TOKEN], startLedger: 1_000 })) void _;
    expect(rpc.calls).toContain(`getEvents:start=${50_000 + EVENT_WINDOW_MARGIN_LEDGERS}`);
  });

  it("events keeps a start that is already inside the window", async () => {
    const rpc = new FakeRpc();
    rpc.oldestLedger = 50_000;
    rpc.latestLedger = 60_000;
    for await (const _ of client(rpc).chain.events({ contractIds: [TOKEN], startLedger: 55_000 })) void _;
    expect(rpc.calls).toContain("getEvents:start=55000");
  });

  it("eventStart is the start the RPC will accept", async () => {
    const rpc = new FakeRpc();
    rpc.oldestLedger = 50_000;
    const { chain } = client(rpc);
    expect(await chain.eventStart(1)).toBe(50_000 + EVENT_WINDOW_MARGIN_LEDGERS);
    expect(await chain.eventStart(55_000)).toBe(55_000);
  });

  it("eventStart leaves the start alone when the RPC does not report a floor", async () => {
    expect(await client(new FakeRpc()).chain.eventStart(5)).toBe(5);
  });
});

describe("ChainClient.oldestEventLedger (S-22)", () => {
  it("reads the retention floor from getHealth", async () => {
    const rpc = new FakeRpc();
    rpc.oldestLedger = 5_000;
    expect(await client(rpc).chain.oldestEventLedger()).toBe(5_000);
  });
});

describe("Signer", () => {
  it("walletSigner passes networkPassphrase to wallet", async () => {
    const seen: { networkPassphrase: string; address: string }[] = [];
    const wallet: WalletAdapter = {
      address: BIDDER.publicKey(),
      async signTransaction(txXdr, opts) {
        seen.push(opts);
        const tx = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
        tx.sign(BIDDER);
        return { signedTxXdr: tx.toXDR() };
      },
    };
    const { chain, rpc } = client();

    await chain.invoke(AUCTION, "register_participant", [], walletSigner(wallet));

    expect(seen).toEqual([{ networkPassphrase: Networks.STANDALONE, address: BIDDER.publicKey() }]);
    expect(rpc.sent[0]!.signatures).toHaveLength(1);
  });

  it("keypairSigner exposes the address but never the secret", () => {
    const s = keypairSigner(BIDDER.secret());
    expect(s.address).toBe(BIDDER.publicKey());
    expect(JSON.stringify(s)).not.toContain(BIDDER.secret());
    expect(Object.values(s).some((v) => typeof v === "string" && v.startsWith("S"))).toBe(false);
  });
});
