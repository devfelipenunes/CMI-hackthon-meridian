import {
  CmiError,
  Secret,
  addOpenings,
  addressToField,
  buildRegisterWitness,
  encodeRegisterData,
  type Field,
  type TokenKeys,
  type TxResult,
} from "@zolvency-cmi/core";

import type { BidderContext } from "../bidder/context.js";
import type { ConfidentialKeyProvider } from "../keys/provider.js";
import { receiveTransfers } from "./merge.js";
import { opensOnChain, verifiedOpenings, type AccountOpenings } from "./openings.js";
import { syncAccount, type SyncResult } from "./sync.js";

interface BackupKeyProvider extends ConfidentialKeyProvider {
  exportBackup(account: string, tokenAddrF: Field, password: string, opts?: { openings?: Secret<AccountOpenings> }): Promise<string>;
  importBackup(backup: string, password: string): Promise<{ account: string; tokenAddrF: Field; openings: Secret<AccountOpenings> | null }>;
}

function withBackups(keys: ConfidentialKeyProvider): BackupKeyProvider {
  const k = keys as Partial<BackupKeyProvider>;
  if (typeof k.exportBackup !== "function" || typeof k.importBackup !== "function") throw new TypeError("the key provider does not support backups (use BrowserKeyProvider)");
  return keys as BackupKeyProvider;
}

export class AccountApi {
  readonly #ctx: BidderContext;

  constructor(ctx: BidderContext) {
    this.#ctx = ctx;
  }

  get #id() {
    return { me: this.#ctx.signer.address, tokenAddrF: addressToField(this.#ctx.tokenAddress) };
  }

  async ensureRegistered(): Promise<{ keys: TokenKeys; backupRequired: boolean }> {
    const { me, tokenAddrF } = this.#id;
    const existing = await this.#ctx.keys.get(me, tokenAddrF);
    const keys = existing ?? (await this.#ctx.keys.create(me, tokenAddrF));
    if ((await this.#ctx.token.account(me)) === null) {
      const w = buildRegisterWitness(keys);
      const { proof } = await this.#ctx.prover.prove("register", w.inputs);
      const { auditorId } = await this.#ctx.factory.getPlatformConfig();
      const r = await this.#ctx.token.register(this.#ctx.signer, auditorId, encodeRegisterData(w, proof));
      await this.#ctx.openings.put(me, tokenAddrF, new Secret({ spendable: { v: 0n, r: 0n }, receiving: { v: 0n, r: 0n }, lastDeposit: null, syncedLedger: r.ledger }));
    }
    return { keys, backupRequired: existing === null };
  }

  async #verified() {
    const { me, tokenAddrF } = this.#id;
    const account = await this.#ctx.token.account(me);
    if (account === null) throw new CmiError("Token.AccountNotRegistered", "the confidential account is not registered");
    return verifiedOpenings(this.#ctx.openings, me, tokenAddrF, account);
  }

  async deposit(amount: bigint): Promise<TxResult> {
    const { me, tokenAddrF } = this.#id;
    const o = (await this.#verified()).expose();
    const r = await this.#ctx.token.deposit(this.#ctx.signer, amount);
    await this.#ctx.openings.put(me, tokenAddrF, new Secret({ ...o, receiving: addOpenings(o.receiving, { v: amount, r: 0n }), lastDeposit: amount, syncedLedger: r.ledger }));
    return r;
  }

  receive(fromLedger: number): Promise<{ transfers: number }> {
    return receiveTransfers(this.#ctx, fromLedger);
  }

  async merge(): Promise<TxResult> {
    const { me, tokenAddrF } = this.#id;
    const o = (await this.#verified()).expose();
    const r = await this.#ctx.token.merge(this.#ctx.signer);
    await this.#ctx.openings.put(me, tokenAddrF, new Secret({ ...o, spendable: addOpenings(o.spendable, o.receiving), receiving: { v: 0n, r: 0n }, syncedLedger: r.ledger }));
    return r;
  }

  sync(opts?: { fromLedger?: number }): Promise<SyncResult> {
    return syncAccount(this.#ctx, opts);
  }

  async exportBackup(password: string): Promise<string> {
    const keys = withBackups(this.#ctx.keys);
    const { me, tokenAddrF } = this.#id;
    let openings: Secret<AccountOpenings> | null = null;
    try {
      openings = await this.#ctx.openings.get(me, tokenAddrF);
    } catch {
      openings = null;
    }
    const account = await this.#ctx.token.account(me);
    const current = openings !== null && account !== null && opensOnChain(openings.expose(), account);
    return keys.exportBackup(me, tokenAddrF, password, current ? { openings: openings! } : {});
  }

  async importBackup(backup: string, password: string): Promise<{ account: string; openings: boolean }> {
    const r = await withBackups(this.#ctx.keys).importBackup(backup, password);
    if (r.openings !== null) await this.#ctx.openings.put(r.account, r.tokenAddrF, r.openings);
    return { account: r.account, openings: r.openings !== null };
  }

  async balance(): Promise<{ spendable: bigint; receiving: bigint }> {
    const o = (await this.#verified()).expose();
    return { spendable: o.spendable.v, receiving: o.receiving.v };
  }
}
