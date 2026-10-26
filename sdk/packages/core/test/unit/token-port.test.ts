import { Address, Contract, Keypair, Networks, StrKey, nativeToScVal, xdr, type Transaction, type rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { ChainClient, EVENT_WINDOW_MARGIN_LEDGERS, TOKEN_H, chainTokenPort, keypairSigner, pointToBytes, scalarMul, toBytes32BE } from "../../src/index.js";
import { FakeRpc, contractErrorEvent } from "../helpers/rpc.js";

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
const AUDITOR = StrKey.encodeContract(Buffer.alloc(32, 3));
const SPENDER = StrKey.encodeContract(Buffer.alloc(32, 7));
const BIDDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();

const P1 = scalarMul(11n, TOKEN_H);
const P2 = scalarMul(22n, TOKEN_H);
const P3 = scalarMul(33n, TOKEN_H);
const P4 = scalarMul(44n, TOKEN_H);
const bytes = (b: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(b));
const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

function setup(rpc = new FakeRpc()) {
  const chain = new ChainClient({ rpcUrl: "http://x", networkPassphrase: Networks.STANDALONE, server: rpc, pollIntervalMs: 0 });
  return { rpc, port: chainTokenPort({ chain, token: TOKEN, auditor: AUDITOR }) };
}

function call(tx: Transaction): { contract: string; fn: string; args: xdr.ScVal[] } {
  const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
  const ic = op.func.invokeContract();
  return { contract: Address.fromScAddress(ic.contractAddress()).toString(), fn: ic.functionName().toString(), args: ic.args() };
}

const addr = (v: xdr.ScVal): string => Address.fromScVal(v).toString();

describe("chainTokenPort: escritas (assinaturas do WASM fixado do token)", () => {
  const signer = keypairSigner(BIDDER.secret());

  it("register sends (account, auditor_id, data)", async () => {
    const { rpc, port } = setup();
    await port.register(signer, 0, new Uint8Array([1, 2, 3]));
    const c = call(rpc.sent[0]!);
    expect([c.contract, c.fn]).toEqual([TOKEN, "register"]);
    expect([addr(c.args[0]!), c.args[1]!.u32(), [...c.args[2]!.bytes()]]).toEqual([BIDDER.publicKey(), 0, [1, 2, 3]]);
  });

  it("deposit sends from = to = signer and the amount as i128", async () => {
    const { rpc, port } = setup();
    await port.deposit(signer, 200_000n);
    const c = call(rpc.sent[0]!);
    expect(c.fn).toBe("deposit");
    expect([addr(c.args[0]!), addr(c.args[1]!)]).toEqual([BIDDER.publicKey(), BIDDER.publicKey()]);
    expect(c.args[2]!.switch()).toBe(xdr.ScValType.scvI128());
    expect(c.args[2]!.i128().lo().toString()).toBe("200000");
  });

  it("deposit refuses a non-positive amount before any call", async () => {
    const { rpc, port } = setup();
    await expect(port.deposit(signer, 0n)).rejects.toThrow(RangeError);
    expect(rpc.calls).toEqual([]);
  });

  it("merge sends (account)", async () => {
    const { rpc, port } = setup();
    await port.merge(signer);
    const c = call(rpc.sent[0]!);
    expect([c.fn, c.args.map(addr)]).toEqual(["merge", [BIDDER.publicKey()]]);
  });

  it("setSpender sends (account, spender, live_until_ledger, data)", async () => {
    const { rpc, port } = setup();
    await port.setSpender(signer, SPENDER, 123_456, new Uint8Array([9]));
    const c = call(rpc.sent[0]!);
    expect(c.fn).toBe("set_spender");
    expect([addr(c.args[0]!), addr(c.args[1]!), c.args[2]!.u32(), [...c.args[3]!.bytes()]]).toEqual([BIDDER.publicKey(), SPENDER, 123_456, [9]]);
  });

  it("revokeSpender sends (account, spender, data)", async () => {
    const { rpc, port } = setup();
    await port.revokeSpender(signer, SPENDER, new Uint8Array([8]));
    const c = call(rpc.sent[0]!);
    expect([c.fn, addr(c.args[0]!), addr(c.args[1]!), [...c.args[2]!.bytes()]]).toEqual(["revoke_spender", BIDDER.publicKey(), SPENDER, [8]]);
  });

  it("spenderTransfer sends confidential_transfer_from(spender, from, to, data), signed by the spender", async () => {
    const { rpc, port } = setup();
    await port.spenderTransfer(signer, OTHER, SPENDER, new Uint8Array([7]));
    const c = call(rpc.sent[0]!);
    expect(c.fn).toBe("confidential_transfer_from");
    expect([addr(c.args[0]!), addr(c.args[1]!), addr(c.args[2]!), [...c.args[3]!.bytes()]]).toEqual([BIDDER.publicKey(), OTHER, SPENDER, [7]]);
    expect(rpc.sent[0]!.source).toBe(BIDDER.publicKey());
  });

  it("a token error keeps its Token.* code", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3503)", [contractErrorEvent(TOKEN, 3503)]);
    await expect(setup(rpc).port.setSpender(signer, SPENDER, 1, new Uint8Array())).rejects.toMatchObject({ code: "Token.DelegationAlreadyExists" });
  });
});

describe("chainTokenPort: leituras", () => {
  it("account decodes ConfidentialAccount", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({
      retval: xdr.ScVal.scvMap([
        entry("auditor_id", xdr.ScVal.scvU32(0)),
        entry("receiving_balance", bytes(pointToBytes(P1))),
        entry("spendable_balance", bytes(pointToBytes(P2))),
        entry("spending_key", bytes(pointToBytes(P3))),
        entry("viewing_public_key", bytes(pointToBytes(P4))),
      ]),
    });
    const { port } = setup(rpc);
    expect(await port.account(BIDDER.publicKey())).toEqual({
      auditorId: 0, receivingBalance: P1, spendableBalance: P2, spendingKey: P3, viewingPublicKey: P4,
    });
    expect(call(rpc.simulated[0]!).fn).toBe("confidential_balance");
  });

  it("account is null for an unregistered address (AccountNotRegistered)", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3501)");
    expect(await setup(rpc).port.account(BIDDER.publicKey())).toBeNull();
  });

  it("delegation decodes SpenderDelegation (escrowed_dvk = rX ‖ cipher)", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({
      retval: xdr.ScVal.scvMap([
        entry("allowance_commitment", bytes(pointToBytes(P1))),
        entry("allowance_salt", bytes(toBytes32BE(5n))),
        entry("encrypted_allowance", bytes(toBytes32BE(6n))),
        entry("escrowed_dvk", bytes(new Uint8Array([...toBytes32BE(7n), ...toBytes32BE(8n)]))),
        entry("live_until_ledger", xdr.ScVal.scvU32(99)),
      ]),
    });
    expect(await setup(rpc).port.delegation(BIDDER.publicKey(), SPENDER)).toEqual({
      allowanceCommitment: P1, allowanceSalt: 5n, encryptedAllowance: 6n, escrowedDvk: { rX: 7n, cipher: 8n }, liveUntilLedger: 99,
    });
  });

  it("delegation is null when the token panics DelegationNotFound", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3504)");
    expect(await setup(rpc).port.delegation(BIDDER.publicKey(), SPENDER)).toBeNull();
  });

  it("other read errors are not swallowed", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simError("HostError: Error(Contract, #3510)");
    await expect(setup(rpc).port.account(BIDDER.publicKey())).rejects.toMatchObject({ code: "Token.AuditorNotSet" });
  });

  it("isSpender reads the bool", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: xdr.ScVal.scvBool(true) });
    expect(await setup(rpc).port.isSpender(BIDDER.publicKey(), SPENDER)).toBe(true);
  });

  it("auditorKey reads get_key(id) on the auditor contract", async () => {
    const rpc = new FakeRpc();
    rpc.simulation = FakeRpc.simSuccess({ retval: bytes(pointToBytes(P4)) });
    expect(await setup(rpc).port.auditorKey(0)).toEqual(P4);
    const c = call(rpc.simulated[0]!);
    expect([c.contract, c.fn, c.args[0]!.u32()]).toEqual([AUDITOR, "get_key", 0]);
  });
});

describe("chainTokenPort: eventos (passo 5.6)", () => {
  it("spenderTransfers decodes the spender_transfer events addressed to an account", async () => {
    const rpc = new FakeRpc();
    const topic = [xdr.ScVal.scvSymbol("spender_transfer"), new Address(SPENDER).toScVal(), new Address(OTHER).toScVal(), new Address(BIDDER.publicKey()).toScVal()];
    rpc.eventPages = [
      [
        {
          id: "0000000001-0000000001",
          type: "contract",
          ledger: 1_234,
          ledgerClosedAt: "",
          contractId: new Contract(TOKEN),
          topic,
          value: xdr.ScVal.scvMap([
            entry("a_aud_s", bytes(toBytes32BE(1n))),
            entry("r_aud_r", bytes(toBytes32BE(2n))),
            entry("r_e", bytes(pointToBytes(P1))),
            entry("sigma_a", bytes(toBytes32BE(9n))),
            entry("v_aud_r", bytes(toBytes32BE(3n))),
            entry("v_aud_s", bytes(toBytes32BE(4n))),
            entry("v_tilde", bytes(toBytes32BE(8n))),
          ]),
          txHash: "ab".repeat(32),
          inSuccessfulContractCall: true,
          pagingToken: "",
        } as unknown as rpc.Api.EventResponse,
      ],
    ];
    const got = await setup(rpc).port.spenderTransfers({ to: BIDDER.publicKey(), startLedger: 1_000 });
    expect(got).toEqual([{ spender: SPENDER, from: OTHER, to: BIDDER.publicKey(), rE: P1, vTilde: 8n, sigma: 9n, ledger: 1_234 }]);
    expect(rpc.calls).toContain("getEvents:start=1000");
  });

  it("spenderTransfers asks no older than the RPC retention floor (S-23)", async () => {
    const rpc = new FakeRpc();
    rpc.oldestLedger = 50_000;
    rpc.latestLedger = 60_000;
    expect(await setup(rpc).port.spenderTransfers({ to: BIDDER.publicKey(), startLedger: 1_000 })).toEqual([]);
    expect(rpc.calls).toContain(`getEvents:start=${50_000 + EVENT_WINDOW_MARGIN_LEDGERS}`);
  });
});

describe("chainTokenPort.accountEvents (S-22, eventos do token @ 539968f)", () => {
  const ME = BIDDER.publicKey();
  const a = (s: string): xdr.ScVal => new Address(s).toScVal();
  const f32 = (k: string, v: bigint) => entry(k, bytes(toBytes32BE(v)));
  const pt = (k: string, p: typeof P1) => entry(k, bytes(pointToBytes(p)));
  let seq = 0;

  const ev = (ledger: number, name: string, topics: xdr.ScVal[], data: xdr.ScMapEntry[]): rpc.Api.EventResponse =>
    ({
      id: `${String(ledger).padStart(10, "0")}-${String(++seq).padStart(10, "0")}`,
      type: "contract", ledger, ledgerClosedAt: "", contractId: new Contract(TOKEN), txHash: "ab".repeat(32),
      inSuccessfulContractCall: true, pagingToken: "",
      topic: [xdr.ScVal.scvSymbol(name), ...topics],
      value: xdr.ScVal.scvMap(data),
    }) as unknown as rpc.Api.EventResponse;
  const sym = (s: string): string => xdr.ScVal.scvSymbol(s).toXDR("base64");
  const me = (): string => a(ME).toXDR("base64");

  it("asks the RPC, in one request, for every event that touches the account", async () => {
    const rpc = new FakeRpc();
    await setup(rpc).port.accountEvents({ account: ME, startLedger: 1_000 });
    const topics = rpc.eventRequests[0]!.filters.flatMap((f) => f.topics ?? []);
    expect(topics).toEqual(
      expect.arrayContaining([
        [sym("register"), me()],
        [sym("deposit"), "*", me()],
        [sym("merge"), me()],
        [sym("set_spender"), me(), "*"],
        [sym("revoke_spender"), me(), "*"],
        [sym("withdraw"), me(), "*"],
        [sym("transfer"), me(), "*"],
        [sym("transfer"), "*", me()],
        [sym("spender_transfer"), "*", "*", me()],
      ]),
    );
    expect(topics).toHaveLength(9);
  });

  it("decodes each event into what it does to the account's openings, in RPC order", async () => {
    const rpc = new FakeRpc();
    rpc.latestLedger = 2_000;
    rpc.eventPages = [
      [
        ev(1_001, "register", [a(ME)], [entry("auditor_id", xdr.ScVal.scvU32(0))]),
        ev(1_002, "deposit", [a(ME), a(ME)], [entry("amount", nativeToScVal(300_000n, { type: "i128" }))]),
        ev(1_002, "merge", [a(ME)], []),
        ev(1_003, "set_spender", [a(ME), a(SPENDER)], [entry("b_aud_s", bytes(toBytes32BE(1n))), f32("b_tilde", 21n), entry("live_until_ledger", xdr.ScVal.scvU32(9)), pt("r_e", P1), f32("sigma", 22n), f32("v_aud_s", 1n)]),
        ev(1_004, "spender_transfer", [a(SPENDER), a(ME), a(ME)], [f32("a_aud_s", 1n), f32("r_aud_r", 1n), pt("r_e", P2), f32("sigma_a", 31n), f32("v_aud_r", 1n), f32("v_aud_s", 1n), f32("v_tilde", 32n)]),
        ev(1_005, "revoke_spender", [a(ME), a(SPENDER)], [f32("b_aud_s", 1n), f32("b_tilde", 41n), pt("r_e", P3), f32("sigma", 42n), f32("v_aud_s", 1n)]),
        ev(1_006, "transfer", [a(OTHER), a(ME)], [f32("b_aud_s", 1n), f32("b_tilde", 9n), pt("r_e", P4), f32("r_aud_r", 1n), f32("sigma", 51n), f32("v_aud_r", 1n), f32("v_aud_s", 1n), f32("v_tilde", 52n)]),
        ev(1_007, "withdraw", [a(ME), a(OTHER)], [entry("amount", nativeToScVal(5n, { type: "i128" })), f32("b_aud_s", 1n), f32("b_tilde", 61n), pt("r_e", P1), f32("sigma", 62n)]),
      ],
    ];
    const got = await setup(rpc).port.accountEvents({ account: ME, startLedger: 1_000 });
    expect(got.fromLedger).toBe(1_000);
    expect(got.toLedger).toBe(2_000);
    expect(got.events.map(({ id: _id, ...e }) => e)).toEqual([
      { kind: "registered", ledger: 1_001 },
      { kind: "deposited", amount: 300_000n, ledger: 1_002 },
      { kind: "merged", ledger: 1_002 },
      { kind: "spendableSet", via: "set_spender", bTilde: 21n, sigma: 22n, ledger: 1_003 },
      { kind: "received", via: "spender_transfer", from: ME, rE: P2, vTilde: 32n, sigma: 31n, ledger: 1_004 },
      { kind: "spendableSet", via: "revoke_spender", bTilde: 41n, sigma: 42n, ledger: 1_005 },
      { kind: "received", via: "transfer", from: OTHER, rE: P4, vTilde: 52n, sigma: 51n, ledger: 1_006 },
      { kind: "spendableSet", via: "withdraw", bTilde: 61n, sigma: 62n, ledger: 1_007 },
    ]);
  });

  it("an outgoing transfer resets the spendable balance; one to self also credits the receiving one", async () => {
    const rpc = new FakeRpc();
    rpc.latestLedger = 2_000;
    const data = [f32("b_aud_s", 1n), f32("b_tilde", 71n), pt("r_e", P1), f32("r_aud_r", 1n), f32("sigma", 72n), f32("v_aud_r", 1n), f32("v_aud_s", 1n), f32("v_tilde", 73n)];
    rpc.eventPages = [[ev(1_010, "transfer", [a(ME), a(OTHER)], data), ev(1_011, "transfer", [a(ME), a(ME)], data)]];
    const got = await setup(rpc).port.accountEvents({ account: ME, startLedger: 1_000 });
    expect(got.events.map((e) => [e.kind, e.ledger])).toEqual([
      ["spendableSet", 1_010],
      ["spendableSet", 1_011],
      ["received", 1_011],
    ]);
  });

  it("clamps the start to the RPC retention floor plus a margin, and says so", async () => {
    const rpc = new FakeRpc();
    rpc.oldestLedger = 50_000;
    rpc.latestLedger = 200_000;
    const got = await setup(rpc).port.accountEvents({ account: ME, startLedger: 1 });
    expect(got.fromLedger).toBe(50_000 + EVENT_WINDOW_MARGIN_LEDGERS);
    expect(rpc.calls).toContain(`getEvents:start=${50_000 + EVENT_WINDOW_MARGIN_LEDGERS}`);
  });

  it("drops events after the ledger it read as the latest (toLedger is exact)", async () => {
    const rpc = new FakeRpc();
    rpc.latestLedger = 1_500;
    rpc.eventPages = [[ev(1_400, "merge", [a(ME)], []), ev(1_600, "merge", [a(ME)], [])]];
    const got = await setup(rpc).port.accountEvents({ account: ME, startLedger: 1_000 });
    expect(got.events.map((e) => e.ledger)).toEqual([1_400]);
  });
});
