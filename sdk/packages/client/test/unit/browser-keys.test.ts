import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { FR_MODULUS, addressToField } from "@zolvency-cmi/core";

import { BrowserKeyProvider, InMemoryKeyProvider } from "../../src/index.js";

const TOKEN_F = addressToField("CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F");
const OTHER_TOKEN_F = addressToField("CDDP6V3GFM44B5XD7YGWN4WLSEUAVZG2FYMK3UKH7DTBRBFN7CTFP3Y5");
const ANA = "GDYWZQYPXOS3ALAAXMEUL4A6ZDMXKVVONTJEZOLE6DLT7WJRN666VBOV";
const BRUNO = "GAMZVG3GFHMU7L46Q7CX7TGI7RXAUOBKMKJ3YL4D66XBU3OCGDCZEP6H";
const SK = 0x00c0_ffee_0123_4567_89ab_cdef_0011_2233_4455_6677_8899_aabb_ccdd_eeffn;
const PASSWORD = "correct horse battery staple";

const fixedRng = (sk = SK) => ({ field: vi.fn(), scalar: vi.fn(() => sk) });

function provider(opts: { indexedDB?: IDBFactory; network?: string; sk?: bigint } = {}) {
  return new BrowserKeyProvider({
    network: opts.network ?? "testnet",
    indexedDB: opts.indexedDB ?? new IDBFactory(),
    rng: fixedRng(opts.sk),
  });
}

async function dumpDatabase(factory: IDBFactory, name = "cmi-confidential-keys"): Promise<string> {
  const db = await new Promise<IDBDatabase>((ok, ko) => {
    const r = factory.open(name);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const out: unknown[] = [];
  for (const store of Array.from(db.objectStoreNames)) {
    out.push(
      await new Promise((ok) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => ok(r.result);
      }),
    );
  }
  db.close();
  return JSON.stringify(out, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("hex") : typeof v === "bigint" ? v.toString(16) : v));
}

describe("BrowserKeyProvider (S-10)", () => {
  it("create then get returns the same keys", async () => {
    const p = provider();
    const created = await p.create(ANA, TOKEN_F);
    const got = await p.get(ANA, TOKEN_F);
    expect(got!.sk.expose()).toBe(created.sk.expose());
    expect(got!.Y).toEqual(created.Y);
  });

  it("get returns null before create", async () => {
    expect(await provider().get(ANA, TOKEN_F)).toBeNull();
  });

  it("keys are scoped by network, token and account", async () => {
    const idb = new IDBFactory();
    await provider({ indexedDB: idb }).create(ANA, TOKEN_F);
    expect(await provider({ indexedDB: idb }).get(BRUNO, TOKEN_F)).toBeNull();
    expect(await provider({ indexedDB: idb }).get(ANA, OTHER_TOKEN_F)).toBeNull();
    expect(await provider({ indexedDB: idb, network: "local" }).get(ANA, TOKEN_F)).toBeNull();
  });

  it("create refuses to overwrite an existing key", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    await expect(p.create(ANA, TOKEN_F)).rejects.toMatchObject({ code: "KeyAlreadyExists" });
  });

  it("stored record does not contain sk in clear", async () => {
    const idb = new IDBFactory();
    await provider({ indexedDB: idb }).create(ANA, TOKEN_F);
    const raw = (await dumpDatabase(idb)).toLowerCase();
    expect(raw).not.toContain(SK.toString(16));
    expect(raw).not.toContain(SK.toString());
  });

  it("wrapping CryptoKey is non-extractable", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    const key = await p.wrappingKeyForTests();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("create uses the injected Rng", async () => {
    const rng = fixedRng();
    const p = new BrowserKeyProvider({ network: "testnet", indexedDB: new IDBFactory(), rng });
    const k = await p.create(ANA, TOKEN_F);
    expect(rng.scalar).toHaveBeenCalledOnce();
    expect(k.sk.expose()).toBe(SK);
  });

  it("backupRequired is true after create and false after markBackedUp", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    expect(await p.backupStatus(ANA, TOKEN_F)).toEqual({ backupRequired: true });
    await p.markBackedUp(ANA, TOKEN_F);
    expect(await p.backupStatus(ANA, TOKEN_F)).toEqual({ backupRequired: false });
  });

  it("forget removes the key", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    await p.forget(ANA, TOKEN_F);
    expect(await p.get(ANA, TOKEN_F)).toBeNull();
  });
});

describe("backup", () => {
  it("exportBackup then importBackup in a fresh db restores the same sk", async () => {
    const backup = await (async () => {
      const p = provider();
      await p.create(ANA, TOKEN_F);
      return p.exportBackup(ANA, TOKEN_F, PASSWORD);
    })();
    const fresh = provider({ sk: 1n });
    await fresh.importBackup(backup, PASSWORD);
    expect((await fresh.get(ANA, TOKEN_F))!.sk.expose()).toBe(SK);
    expect(await fresh.backupStatus(ANA, TOKEN_F)).toEqual({ backupRequired: false });
  });

  it("importBackup with wrong password fails with a typed error and writes nothing", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    const backup = await p.exportBackup(ANA, TOKEN_F, PASSWORD);
    const idb = new IDBFactory();
    const fresh = provider({ indexedDB: idb });
    await expect(fresh.importBackup(backup, "wrong password")).rejects.toMatchObject({ code: "InvalidBackup" });
    expect(await fresh.get(ANA, TOKEN_F)).toBeNull();
  });

  it("importBackup rejects garbage with InvalidBackup", async () => {
    await expect(provider().importBackup("not a backup", PASSWORD)).rejects.toMatchObject({ code: "InvalidBackup" });
  });

  it("backup text has no sk in clear and no password", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    const backup = await p.exportBackup(ANA, TOKEN_F, PASSWORD);
    expect(backup.startsWith("cmi-key-backup:v1:")).toBe(true);
    const decoded = Buffer.from(backup.slice("cmi-key-backup:v1:".length), "base64").toString("utf8").toLowerCase();
    for (const text of [backup.toLowerCase(), decoded]) {
      expect(text).not.toContain(SK.toString(16));
      expect(text).not.toContain(PASSWORD);
    }
  });

  it("exportBackup refuses a short password", async () => {
    const p = provider();
    await p.create(ANA, TOKEN_F);
    await expect(p.exportBackup(ANA, TOKEN_F, "short")).rejects.toThrow(RangeError);
  });

  it("exportBackup of an unknown key fails with KeyNotFound", async () => {
    await expect(provider().exportBackup(ANA, TOKEN_F, PASSWORD)).rejects.toMatchObject({ code: "KeyNotFound" });
  });
});

describe("InMemoryKeyProvider", () => {
  it("create then get, scoped by account and token", async () => {
    const p = new InMemoryKeyProvider({ rng: fixedRng() });
    const k = await p.create(ANA, TOKEN_F);
    expect((await p.get(ANA, TOKEN_F))!.sk.expose()).toBe(k.sk.expose());
    expect(await p.get(BRUNO, TOKEN_F)).toBeNull();
    expect(k.sk.expose() < FR_MODULUS).toBe(true);
  });
});
