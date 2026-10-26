import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

import type { ChainClient, TxResult } from "../chain/client.js";
import type { AccountId, ContractId } from "../chain/events.js";
import type { Signer } from "../chain/signer.js";
import { CmiError } from "../errors/CmiError.js";
import { fromBytes32BE, pointFromBytes, type Point } from "../field/encoding.js";
import type { Field } from "../field/field.js";
import type { OnChainDelegation } from "../token/delegation.js";

export interface SpenderTransferEvent {
  spender: ContractId | AccountId;
  from: AccountId;
  to: AccountId | ContractId;
  rE: Point;
  vTilde: Field;
  sigma: Field;
  ledger: number;
}

export type TokenAccountEvent = { id: string; ledger: number } & (
  | { kind: "registered" }
  | { kind: "deposited"; amount: bigint }
  | { kind: "merged" }
  | { kind: "spendableSet"; via: "set_spender" | "revoke_spender" | "withdraw" | "transfer"; bTilde: Field; sigma: Field }
  | { kind: "received"; via: "spender_transfer" | "transfer"; from: AccountId; rE: Point; vTilde: Field; sigma: Field }
);

export interface AccountEventsPage {
  events: TokenAccountEvent[];
  fromLedger: number;
  toLedger: number;
}

export interface OnChainAccount {
  spendingKey: Point;
  viewingPublicKey: Point;
  spendableBalance: Point;
  receivingBalance: Point;
  auditorId: number;
}

export interface TokenPort {
  account(a: AccountId | ContractId): Promise<OnChainAccount | null>;
  delegation(owner: AccountId, spender: AccountId | ContractId): Promise<OnChainDelegation | null>;
  isSpender(owner: AccountId, spender: AccountId | ContractId): Promise<boolean>;
  auditorKey(id: number): Promise<Point>;
  register(s: Signer, auditorId: number, data: Uint8Array): Promise<TxResult>;

  deposit(s: Signer, amount: bigint): Promise<TxResult>;
  merge(s: Signer): Promise<TxResult>;
  setSpender(s: Signer, spender: AccountId | ContractId, liveUntilLedger: number, data: Uint8Array): Promise<TxResult>;
  revokeSpender(s: Signer, spender: AccountId | ContractId, data: Uint8Array): Promise<TxResult>;

  spenderTransfer(s: Signer, from: AccountId, to: AccountId | ContractId, data: Uint8Array): Promise<TxResult>;

  spenderTransfers(q: { to: AccountId | ContractId; startLedger: number }): Promise<SpenderTransferEvent[]>;

  accountEvents(q: { account: AccountId; startLedger: number }): Promise<AccountEventsPage>;
}

const addr = (a: string): xdr.ScVal => new Address(a).toScVal();
const u32 = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);
const bytes = (b: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(b));
const raw = (v: xdr.ScVal): Uint8Array => new Uint8Array(v.bytes());

function fields(v: xdr.ScVal): Map<string, xdr.ScVal> {
  const entries = v.map();
  if (entries === null) throw new CmiError("TxFailed", "token returned a value that is not a struct");
  return new Map(entries.map((e) => [e.key().sym().toString(), e.val()]));
}

function get(f: Map<string, xdr.ScVal>, key: string): xdr.ScVal {
  const v = f.get(key);
  if (v === undefined) throw new CmiError("TxFailed", `token struct without ${key}`);
  return v;
}

async function orNull<T>(code: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof CmiError && e.code === code) return null;
    throw e;
  }
}

export function chainTokenPort(cfg: { chain: ChainClient; token: ContractId; auditor: ContractId }): TokenPort {
  const { chain, token } = cfg;
  const read = (method: string, args: xdr.ScVal[]) => chain.simulate(token, method, args);
  const write = (s: Signer, method: string, args: xdr.ScVal[]) => chain.invoke(token, method, args, s);

  return {
    account: (a) =>
      orNull("Token.AccountNotRegistered", async () => {
        const f = fields(await read("confidential_balance", [addr(a)]));
        return {
          spendingKey: pointFromBytes(raw(get(f, "spending_key"))),
          viewingPublicKey: pointFromBytes(raw(get(f, "viewing_public_key"))),
          spendableBalance: pointFromBytes(raw(get(f, "spendable_balance"))),
          receivingBalance: pointFromBytes(raw(get(f, "receiving_balance"))),
          auditorId: get(f, "auditor_id").u32(),
        };
      }),

    delegation: (owner, spender) =>
      orNull("Token.DelegationNotFound", async () => {
        const f = fields(await read("get_spender_delegation", [addr(owner), addr(spender)]));
        const esc = raw(get(f, "escrowed_dvk"));
        return {
          allowanceCommitment: pointFromBytes(raw(get(f, "allowance_commitment"))),
          encryptedAllowance: fromBytes32BE(raw(get(f, "encrypted_allowance"))),
          escrowedDvk: { rX: fromBytes32BE(esc.subarray(0, 32)), cipher: fromBytes32BE(esc.subarray(32, 64)) },
          allowanceSalt: fromBytes32BE(raw(get(f, "allowance_salt"))),
          liveUntilLedger: get(f, "live_until_ledger").u32(),
        };
      }),

    isSpender: async (owner, spender) => (await read("is_spender", [addr(owner), addr(spender)])).b(),

    auditorKey: async (id) => pointFromBytes(raw(await chain.simulate(cfg.auditor, "get_key", [u32(id)]))),

    register: (s, auditorId, data) => write(s, "register", [addr(s.address), u32(auditorId), bytes(data)]),

    deposit: async (s, amount) => {
      if (amount <= 0n) throw new RangeError("deposit amount must be positive");
      return write(s, "deposit", [addr(s.address), addr(s.address), nativeToScVal(amount, { type: "i128" })]);
    },

    merge: (s) => write(s, "merge", [addr(s.address)]),

    setSpender: (s, spender, liveUntilLedger, data) =>
      write(s, "set_spender", [addr(s.address), addr(spender), u32(liveUntilLedger), bytes(data)]),

    revokeSpender: (s, spender, data) => write(s, "revoke_spender", [addr(s.address), addr(spender), bytes(data)]),

    spenderTransfer: (s, from, to, data) =>
      write(s, "confidential_transfer_from", [addr(s.address), addr(from), addr(to), bytes(data)]),

    spenderTransfers: async ({ to, startLedger }) => {

      const topics = [[xdr.ScVal.scvSymbol("spender_transfer").toXDR("base64"), "*", "*", addr(to).toXDR("base64")]];
      const out: SpenderTransferEvent[] = [];
      for await (const e of chain.events({ contractIds: [token], topics, startLedger })) {
        const f = fields(e.data);
        const [, spender, from, dest] = e.topics.map((t, i) => (i === 0 ? "" : Address.fromScVal(t).toString()));
        out.push({
          spender: spender!,
          from: from!,
          to: dest!,
          rE: pointFromBytes(raw(get(f, "r_e"))),
          vTilde: fromBytes32BE(raw(get(f, "v_tilde"))),
          sigma: fromBytes32BE(raw(get(f, "sigma_a"))),
          ledger: e.ledger ?? 0,
        });
      }
      return out;
    },

    accountEvents: async ({ account, startLedger }) => {
      const fromLedger = await chain.eventStart(startLedger);
      const toLedger = await chain.latestLedger();
      const me = addr(account).toXDR("base64");
      const sym = (s: string): string => xdr.ScVal.scvSymbol(s).toXDR("base64");

      const topics = [
        [sym("register"), me],
        [sym("deposit"), "*", me],
        [sym("merge"), me],
        [sym("set_spender"), me, "*"],
        [sym("revoke_spender"), me, "*"],
        [sym("withdraw"), me, "*"],
        [sym("transfer"), me, "*"],
        [sym("transfer"), "*", me],
        [sym("spender_transfer"), "*", "*", me],
      ];
      const out: TokenAccountEvent[] = [];
      for await (const e of chain.events({ contractIds: [token], topics, startLedger: fromLedger })) {
        const ledger = e.ledger ?? 0;
        if (ledger > toLedger) break;
        const base = { id: e.id ?? "", ledger };
        const name = e.topics[0]!.sym().toString();
        const who = (i: number): string => Address.fromScVal(e.topics[i]!).toString();
        const f = fields(e.data);
        const field = (k: string): Field => fromBytes32BE(raw(get(f, k)));
        const spendableSet = (via: "set_spender" | "revoke_spender" | "withdraw" | "transfer"): TokenAccountEvent => ({ ...base, kind: "spendableSet", via, bTilde: field("b_tilde"), sigma: field("sigma") });
        if (name === "register") out.push({ ...base, kind: "registered" });
        else if (name === "deposit") out.push({ ...base, kind: "deposited", amount: BigInt(scValToNative(get(f, "amount")) as bigint) });
        else if (name === "merge") out.push({ ...base, kind: "merged" });
        else if (name === "set_spender" || name === "revoke_spender" || name === "withdraw") out.push(spendableSet(name));
        else if (name === "spender_transfer") {
          out.push({ ...base, kind: "received", via: "spender_transfer", from: who(2), rE: pointFromBytes(raw(get(f, "r_e"))), vTilde: field("v_tilde"), sigma: field("sigma_a") });
        } else if (name === "transfer") {

          if (who(1) === account) out.push(spendableSet("transfer"));
          if (who(2) === account) out.push({ ...base, kind: "received", via: "transfer", from: who(1), rE: pointFromBytes(raw(get(f, "r_e"))), vTilde: field("v_tilde"), sigma: field("sigma") });
        }
      }
      return { events: out, fromLedger, toLedger };
    },
  };
}
