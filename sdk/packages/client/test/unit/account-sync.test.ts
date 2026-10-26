import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { pedersenCommit } from "@zolvency-cmi/core";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";

import { AccountApi, BrowserKeyProvider, MemoryOpeningStore } from "../../src/index.js";
import { DEPOSIT, LEDGER, PRICE, QTY, REFUND, accountLifecycle, freshBrowser } from "../helpers/lifecycle.js";

const SPENDABLE = DEPOSIT - PRICE * BigInt(QTY);
const PASSWORD = "correct horse battery staple";

describe("AccountApi.sync (S-22)", () => {
  it("keeps stored openings that already open the chain, without reading events", async () => {
    const l = await accountLifecycle({ refund: false });
    expect(await l.account.sync()).toMatchObject({ source: "stored", events: 0 });
    expect(l.log.all()).not.toContain("token.events.account");
    expect(await l.account.balance()).toEqual({ spendable: SPENDABLE, receiving: 0n });
  });

  it("a fresh browser rebuilds the openings from the account's events (register in the window)", async () => {
    const l = await accountLifecycle();
    const fresh = freshBrowser(l);
    await expect(fresh.account.balance()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await fresh.account.sync()).toMatchObject({ source: "events", syncedLedger: LEDGER.refund });
    expect(await fresh.account.balance()).toEqual({ spendable: SPENDABLE, receiving: REFUND });
  });

  it("the rebuilt openings are usable: merge then spend works", async () => {
    const l = await accountLifecycle();
    const fresh = freshBrowser(l);
    await fresh.account.sync();
    await fresh.account.merge();
    expect(await fresh.account.balance()).toEqual({ spendable: SPENDABLE + REFUND, receiving: 0n });
  });

  it("restores lastDeposit from the last deposit event (DepositRevealsPrice guard, S-17)", async () => {
    const l = await accountLifecycle();
    const fresh = freshBrowser(l);
    await fresh.account.sync();
    expect((await fresh.openings.get(l.me.address, l.tokenAddrF))!.expose().lastDeposit).toBe(DEPOSIT);
  });

  it("a missed incoming transfer is caught up from the checkpoint the operations recorded", async () => {
    const l = await accountLifecycle();
    await expect(l.account.balance()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await l.account.sync()).toMatchObject({ source: "checkpoint", events: 1 });
    expect(await l.account.balance()).toEqual({ spendable: SPENDABLE, receiving: REFUND });
  });

  it("operations record the ledger of their transaction as syncedLedger", async () => {
    const l = await accountLifecycle({ refund: false });
    expect((await l.openings.get(l.me.address, l.tokenAddrF))!.expose().syncedLedger).toBe(LEDGER.bid);
  });

  it("rebuilds without the register when a merge and a lock are in the window (anchors)", async () => {
    const l = await accountLifecycle();
    l.token.oldestEventLedger = LEDGER.deposit;
    const fresh = freshBrowser(l);
    expect(await fresh.account.sync()).toMatchObject({ source: "events" });
    expect(await fresh.account.balance()).toEqual({ spendable: SPENDABLE, receiving: REFUND });
  });

  it("fails with BalanceOutOfSync when the window has no anchor for a balance, and stores nothing", async () => {
    const l = await accountLifecycle();
    l.token.oldestEventLedger = LEDGER.bid + 1;
    const fresh = freshBrowser(l);
    await expect(fresh.account.sync()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await fresh.openings.get(l.me.address, l.tokenAddrF)).toBeNull();
  });

  it("never stores a replay that does not open the on-chain commitments", async () => {
    const l = await accountLifecycle();
    l.token.accounts.get(l.me.address)!.receivingBalance = pedersenCommit(1n, 1n);
    const fresh = freshBrowser(l);
    await expect(fresh.account.sync()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await fresh.openings.get(l.me.address, l.tokenAddrF)).toBeNull();
  });

  it("fromLedger starts the rebuild later (and still fails safe without anchors)", async () => {
    const l = await accountLifecycle();
    const fresh = freshBrowser(l);
    await expect(fresh.account.sync({ fromLedger: LEDGER.refund })).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await fresh.account.sync({ fromLedger: LEDGER.register })).toMatchObject({ source: "events" });
  });

  it("requires the confidential key and a registered account", async () => {
    const l = await accountLifecycle();
    const noKey = new AccountApi({ ...l.ctx, keys: new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory() }), openings: new MemoryOpeningStore() });
    await expect(noKey.sync()).rejects.toMatchObject({ code: "KeyNotFound" });
    l.token.accounts.delete(l.me.address);
    await expect(l.account.sync()).rejects.toMatchObject({ code: "Token.AccountNotRegistered" });
  });

  it("no opening or key in logs or in the result", async () => {
    const l = await accountLifecycle();
    const fresh = freshBrowser(l);
    const result = await fresh.account.sync();
    const o = (await fresh.openings.get(l.me.address, l.tokenAddrF))!.expose();
    assertNoSecretLeak([o.spendable.r, o.receiving.r, l.keys.sk.expose(), l.keys.vk.expose()], [l.logger, result]);
  });
});

describe("backup com o estado da conta (S-22)", () => {
  async function withBrowserKeys() {
    const l = await accountLifecycle();
    const idb = new IDBFactory();
    const keys = new BrowserKeyProvider({ network: "testnet", indexedDB: idb });

    const backup = await (async () => {
      const k = new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory(), rng: { field: () => 0n, scalar: () => l.keys.sk.expose() } });
      await k.create(l.me.address, l.tokenAddrF);
      return k.exportBackup(l.me.address, l.tokenAddrF, PASSWORD);
    })();
    await keys.importBackup(backup, PASSWORD);
    const account = new AccountApi({ ...l.ctx, keys });
    await account.sync();
    return { l, account };
  }

  it("exportBackup carries the openings; importBackup in a fresh browser restores them", async () => {
    const { l, account } = await withBrowserKeys();
    const text = await account.exportBackup(PASSWORD);

    const keys = new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory() });
    const openings = new MemoryOpeningStore();
    const other = new AccountApi({ ...l.ctx, keys, openings });
    expect(await other.importBackup(text, PASSWORD)).toEqual({ account: l.me.address, openings: true });
    l.token.oldestEventLedger = 1_000_000;
    expect(await other.sync()).toMatchObject({ source: "stored" });
    expect(await other.balance()).toEqual({ spendable: SPENDABLE, receiving: REFUND });
  });

  it("a backup without state (older format) still restores the key", async () => {
    const { l } = await withBrowserKeys();
    const k = new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory(), rng: { field: () => 0n, scalar: () => l.keys.sk.expose() } });
    await k.create(l.me.address, l.tokenAddrF);
    const keyOnly = await k.exportBackup(l.me.address, l.tokenAddrF, PASSWORD);
    const other = new AccountApi({ ...l.ctx, keys: new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory() }), openings: new MemoryOpeningStore() });
    expect(await other.importBackup(keyOnly, PASSWORD)).toEqual({ account: l.me.address, openings: false });
  });

  it("the backup text has no opening in clear", async () => {
    const { l, account } = await withBrowserKeys();
    const text = await account.exportBackup(PASSWORD);
    const o = (await l.ctx.openings.get(l.me.address, l.tokenAddrF))!.expose();
    const decoded = Buffer.from(text.slice("cmi-key-backup:v1:".length), "base64").toString("utf8");
    assertNoSecretLeak([o.spendable.r, o.receiving.r], [text, decoded]);
  });

  it("exportBackup needs a key provider with backups", async () => {
    const l = await accountLifecycle();
    await expect(l.account.exportBackup(PASSWORD)).rejects.toThrow(TypeError);
  });
});
