import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { Secret, addressToField } from "@zolvency-cmi/core";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";

import { BrowserOpeningStore, type AccountOpenings } from "../../src/index.js";

const TOKEN_F = addressToField("CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F");
const OTHER_TOKEN_F = addressToField("CDDP6V3GFM44B5XD7YGWN4WLSEUAVZG2FYMK3UKH7DTBRBFN7CTFP3Y5");
const ANA = "GDYWZQYPXOS3ALAAXMEUL4A6ZDMXKVVONTJEZOLE6DLT7WJRN666VBOV";
const BRUNO = "GAMZVG3GFHMU7L46Q7CX7TGI7RXAUOBKMKJ3YL4D66XBU3OCGDCZEP6H";

const OPENINGS: AccountOpenings = {
  spendable: { v: 777_777_777n, r: 0x0abc_def0_1234_5678_9abc_def0_1234_5678n },
  receiving: { v: 555_555_555n, r: 0x0fed_cba9_8765_4321_0fed_cba9_8765_4321n },
  lastDeposit: 444_444_444n,
  syncedLedger: 5_281_761,
};

function store(opts: { indexedDB?: IDBFactory; network?: string; dbName?: string } = {}) {
  return new BrowserOpeningStore({ network: opts.network ?? "testnet", indexedDB: opts.indexedDB ?? new IDBFactory(), ...(opts.dbName === undefined ? {} : { dbName: opts.dbName }) });
}

async function dumpDatabase(factory: IDBFactory, name = "cmi-account-openings"): Promise<string> {
  const db = await new Promise<IDBDatabase>((ok, ko) => {
    const r = factory.open(name);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const out: unknown[] = [];
  for (const name of Array.from(db.objectStoreNames)) {
    out.push(
      await new Promise((ok) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => ok(r.result);
      }),
    );
  }
  db.close();
  return JSON.stringify(out, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("hex") : typeof v === "bigint" ? v.toString(16) : v));
}

describe("BrowserOpeningStore (SDK-A, S-22)", () => {
  it("get returns null before put", async () => {
    expect(await store().get(ANA, TOKEN_F)).toBeNull();
  });

  it("put then get returns the same openings", async () => {
    const s = store();
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    expect((await s.get(ANA, TOKEN_F))!.expose()).toEqual(OPENINGS);
  });

  it("keeps lastDeposit null and an absent syncedLedger as they are", async () => {
    const s = store();
    const bare: AccountOpenings = { spendable: { v: 0n, r: 0n }, receiving: { v: 0n, r: 0n }, lastDeposit: null };
    await s.put(ANA, TOKEN_F, new Secret(bare));
    expect((await s.get(ANA, TOKEN_F))!.expose()).toEqual(bare);
  });

  it("survives a new store instance on the same database (as after a reload)", async () => {
    const idb = new IDBFactory();
    const first = store({ indexedDB: idb });
    await first.put(ANA, TOKEN_F, new Secret(OPENINGS));
    first.close();
    expect((await store({ indexedDB: idb }).get(ANA, TOKEN_F))!.expose()).toEqual(OPENINGS);
  });

  it("put overwrites the previous openings", async () => {
    const s = store();
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    const next = { ...OPENINGS, spendable: { v: 1n, r: 2n } };
    await s.put(ANA, TOKEN_F, new Secret(next));
    expect((await s.get(ANA, TOKEN_F))!.expose()).toEqual(next);
  });

  it("openings are scoped by network, token and account", async () => {
    const idb = new IDBFactory();
    await store({ indexedDB: idb }).put(ANA, TOKEN_F, new Secret(OPENINGS));
    expect(await store({ indexedDB: idb }).get(BRUNO, TOKEN_F)).toBeNull();
    expect(await store({ indexedDB: idb }).get(ANA, OTHER_TOKEN_F)).toBeNull();
    expect(await store({ indexedDB: idb, network: "local" }).get(ANA, TOKEN_F)).toBeNull();
  });

  it("a record copied to another scope does not open (scope is the AES-GCM additional data)", async () => {
    const idb = new IDBFactory();
    const s = store({ indexedDB: idb });
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    await s.copyRecordForTests(ANA, TOKEN_F, BRUNO, TOKEN_F);
    await expect(s.get(BRUNO, TOKEN_F)).rejects.toMatchObject({ code: "BalanceOutOfSync" });
  });

  it("stored record does not contain any opening in clear", async () => {
    const idb = new IDBFactory();
    await store({ indexedDB: idb }).put(ANA, TOKEN_F, new Secret(OPENINGS));
    const raw = (await dumpDatabase(idb)).toLowerCase();
    for (const v of [OPENINGS.spendable.v, OPENINGS.spendable.r, OPENINGS.receiving.v, OPENINGS.receiving.r, OPENINGS.lastDeposit!]) {
      expect(raw).not.toContain(v.toString(16));
      expect(raw).not.toContain(v.toString());
    }
  });

  it("wrapping CryptoKey is non-extractable", async () => {
    const s = store();
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    const key = await s.wrappingKeyForTests();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("forget removes the openings", async () => {
    const s = store();
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    await s.forget(ANA, TOKEN_F);
    expect(await s.get(ANA, TOKEN_F)).toBeNull();
  });

  it("returns openings as Secret (redacted when serialized)", async () => {
    const s = store();
    await s.put(ANA, TOKEN_F, new Secret(OPENINGS));
    const got = await s.get(ANA, TOKEN_F);
    assertNoSecretLeak([OPENINGS.spendable.v, OPENINGS.spendable.r, OPENINGS.receiving.r], [JSON.stringify(got), String(got)]);
  });
});
