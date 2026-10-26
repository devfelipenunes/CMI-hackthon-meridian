import { xdr } from "@stellar/stellar-sdk";
import {
  CmiError,
  TOKEN_H,
  fromBytes32BE,
  pedersenCommit,
  pointAdd,
  pointFromBytes,
  scalarMul,
  type Clock,
  type OnChainAccount,
  type OnChainDelegation,
  type Point,
  type QuotaPort,
  type AccountEventsPage,
  type SpenderTransferEvent,
  type Signer,
  type TokenAccountEvent,
  type TokenPort,
  type TxResult,
} from "@zolvency-cmi/core";

import type { CallLog } from "./log.js";

const IDENTITY: Point = { x: 0n, y: 0n };
let txCounter = 0;
const tx = (ledger = 0): TxResult => ({ hash: (++txCounter).toString(16).padStart(64, "0"), ledger, events: [], cpuInsns: 0, feeCharged: 0n });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function payload(data: Uint8Array): Map<string, Uint8Array> {
  const top = xdr.ScVal.fromXDR(Buffer.from(data)).map();
  const p = top?.find((e) => e.key().sym().toString() === "payload")?.val().map();
  if (p === undefined || p === null) throw new CmiError("Token.InvalidData", "data is not { payload, proof }");
  return new Map(p.map((e) => [e.key().sym().toString(), new Uint8Array(e.val().bytes())]));
}

function field(p: Map<string, Uint8Array>, key: string): Uint8Array {
  const v = p.get(key);
  if (v === undefined) throw new CmiError("Token.InvalidData", `payload without ${key}`);
  return v;
}

export class FakeToken implements TokenPort {
  readonly accounts = new Map<string, OnChainAccount>();
  readonly delegations = new Map<string, OnChainDelegation>();
  readonly deposits: { account: string; amount: bigint }[] = [];

  readonly transfers: SpenderTransferEvent[] = [];

  readonly accountEventLog: { account: string; event: TokenAccountEvent }[] = [];

  oldestEventLedger = 0;
  #eventSeq = 0;
  readonly #log: CallLog;
  readonly #clock: Clock;
  readonly auditor: Point;

  constructor(o: { log: CallLog; clock: Clock; auditorKey?: Point }) {
    this.#log = o.log;
    this.#clock = o.clock;
    this.auditor = o.auditorKey ?? scalarMul(0x0a0d_17e5n, TOKEN_H);
  }

  registerAccount(address: string, spendingKey: Point, spendable: Point = IDENTITY, viewingPublicKey: Point = IDENTITY): void {
    this.accounts.set(address, { spendingKey, viewingPublicKey, spendableBalance: spendable, receivingBalance: IDENTITY, auditorId: 0 });
  }

  #account(a: string): OnChainAccount {
    const acc = this.accounts.get(a);
    if (acc === undefined) throw new CmiError("Token.AccountNotRegistered", "account not registered");
    return acc;
  }

  async account(a: string): Promise<OnChainAccount | null> {
    this.#log.record("token.confidential_balance", false, [a]);
    return this.accounts.get(a) ?? null;
  }

  async delegation(owner: string, spender: string): Promise<OnChainDelegation | null> {
    this.#log.record("token.get_spender_delegation", false, [owner, spender]);
    return this.delegations.get(`${owner}|${spender}`) ?? null;
  }

  async isSpender(owner: string, spender: string): Promise<boolean> {
    this.#log.record("token.is_spender", false, [owner, spender]);
    const d = this.delegations.get(`${owner}|${spender}`);
    return d !== undefined && (await this.#clock.ledger()) <= d.liveUntilLedger;
  }

  async spenderTransfers(q: { to: string; startLedger: number }): Promise<SpenderTransferEvent[]> {
    this.#log.record("token.events.spender_transfer", false, [q.to, q.startLedger]);

    const fromLedger = Math.max(q.startLedger, this.oldestEventLedger);
    return this.transfers.filter((t) => t.to === q.to && t.ledger >= fromLedger);
  }

  async accountEvents(q: { account: string; startLedger: number }): Promise<AccountEventsPage> {
    this.#log.record("token.events.account", false, [q.account, q.startLedger]);
    const fromLedger = Math.max(q.startLedger, this.oldestEventLedger);
    const toLedger = await this.#clock.ledger();
    const events = this.accountEventLog.filter((e) => e.account === q.account && e.event.ledger >= fromLedger && e.event.ledger <= toLedger).map((e) => e.event);
    return { events, fromLedger, toLedger };
  }

  async #emit(account: string, event: DistributiveOmit<TokenAccountEvent, "id" | "ledger">): Promise<number> {
    const ledger = await this.#clock.ledger();
    const id = `${String(ledger).padStart(10, "0")}-${String(++this.#eventSeq).padStart(10, "0")}`;
    this.accountEventLog.push({ account, event: { ...event, id, ledger } as TokenAccountEvent });
    return ledger;
  }

  async auditorKey(_id: number): Promise<Point> {
    this.#log.record("token.get_key", false);
    return this.auditor;
  }

  async register(s: Signer, _auditorId: number, data: Uint8Array): Promise<TxResult> {
    this.#log.record("token.register", true, [s.address]);
    if (this.accounts.has(s.address)) throw new CmiError("Token.AccountAlreadyRegistered", "already registered");

    const p = payload(data);
    this.registerAccount(s.address, pointFromBytes(field(p, "y")), IDENTITY, pointFromBytes(field(p, "pvk")));
    return tx(await this.#emit(s.address, { kind: "registered" }));
  }

  async deposit(s: Signer, amount: bigint): Promise<TxResult> {
    this.#log.record("token.deposit", true, [s.address, amount]);
    const acc = this.#account(s.address);
    acc.receivingBalance = pointAdd(acc.receivingBalance, pedersenCommit(amount, 0n));
    this.deposits.push({ account: s.address, amount });
    return tx(await this.#emit(s.address, { kind: "deposited", amount }));
  }

  async merge(s: Signer): Promise<TxResult> {
    this.#log.record("token.merge", true, [s.address]);
    const acc = this.#account(s.address);
    acc.spendableBalance = pointAdd(acc.spendableBalance, acc.receivingBalance);
    acc.receivingBalance = IDENTITY;
    return tx(await this.#emit(s.address, { kind: "merged" }));
  }

  async setSpender(s: Signer, spender: string, liveUntilLedger: number, data: Uint8Array): Promise<TxResult> {
    this.#log.record("token.set_spender", true, [s.address, spender, liveUntilLedger]);
    const acc = this.#account(s.address);
    this.#account(spender);
    const key = `${s.address}|${spender}`;
    if (this.delegations.has(key)) throw new CmiError("Token.DelegationAlreadyExists", "delegation exists");
    const p = payload(data);
    const esc = field(p, "escrowed_dvk");
    this.delegations.set(key, {
      allowanceCommitment: pointFromBytes(field(p, "c_a")),
      encryptedAllowance: fromBytes32BE(field(p, "a_tilde")),
      escrowedDvk: { rX: fromBytes32BE(esc.subarray(0, 32)), cipher: fromBytes32BE(esc.subarray(32)) },
      allowanceSalt: fromBytes32BE(field(p, "sigma_a")),
      liveUntilLedger,
    });
    acc.spendableBalance = pointFromBytes(field(p, "c_spend_new"));
    return tx(await this.#emit(s.address, { kind: "spendableSet", via: "set_spender", bTilde: fromBytes32BE(field(p, "b_tilde")), sigma: fromBytes32BE(field(p, "sigma")) }));
  }

  async revokeSpender(s: Signer, spender: string, data: Uint8Array): Promise<TxResult> {
    this.#log.record("token.revoke_spender", true, [s.address, spender]);
    const acc = this.#account(s.address);
    if (!this.delegations.delete(`${s.address}|${spender}`)) throw new CmiError("Token.DelegationNotFound", "no delegation");
    const p = payload(data);
    acc.spendableBalance = pointFromBytes(field(p, "c_spend_new"));
    return tx(await this.#emit(s.address, { kind: "spendableSet", via: "revoke_spender", bTilde: fromBytes32BE(field(p, "b_tilde")), sigma: fromBytes32BE(field(p, "sigma")) }));
  }

  async spenderTransfer(s: Signer, from: string, to: string, data: Uint8Array): Promise<TxResult> {
    this.#log.record("token.confidential_transfer_from", true, [s.address, from]);
    const d = this.delegations.get(`${from}|${s.address}`);
    if (d === undefined) throw new CmiError("Token.DelegationNotFound", "no delegation");
    const ledger = await this.#clock.ledger();
    if (ledger > d.liveUntilLedger) throw new CmiError("Token.DelegationExpired", "expired");
    const p = payload(data);
    const recipient = this.#account(to);
    recipient.receivingBalance = pointAdd(recipient.receivingBalance, pointFromBytes(field(p, "c_tx")));
    this.transfers.push({
      spender: s.address,
      from,
      to,
      rE: pointFromBytes(field(p, "r_e")),
      vTilde: fromBytes32BE(field(p, "v_tilde")),
      sigma: d.allowanceSalt,
      ledger,
    });
    await this.#emit(to, { kind: "received", via: "spender_transfer", from, rE: pointFromBytes(field(p, "r_e")), vTilde: fromBytes32BE(field(p, "v_tilde")), sigma: d.allowanceSalt });
    d.allowanceCommitment = pointFromBytes(field(p, "c_a_new"));
    d.allowanceSalt = fromBytes32BE(field(p, "sigma_a_new"));
    d.encryptedAllowance = fromBytes32BE(field(p, "a_tilde_new"));
    return tx();
  }
}

export class FakeQuota implements QuotaPort {
  readonly #lines = new Set<string>();
  readonly #log: CallLog;

  constructor(log: CallLog) {
    this.#log = log;
  }

  addTrustline(asset: string, account: string): void {
    this.#lines.add(`${asset}|${account}`);
  }

  async hasTrustline(asset: string, account: string): Promise<boolean> {
    this.#log.record("quota.balance", false, [asset, account]);
    return this.#lines.has(`${asset}|${account}`);
  }
}
