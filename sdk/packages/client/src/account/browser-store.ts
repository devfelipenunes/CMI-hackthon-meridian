import { CmiError, Secret, toField, type Field } from "@zolvency-cmi/core";

import type { AccountOpenings, OpeningStore } from "./openings.js";

const STORE_OPENINGS = "openings";
const STORE_META = "meta";
const WRAP_KEY_ID = "wrapping-key";

interface StoredOpenings {
  iv: Uint8Array;
  ct: Uint8Array;
}

export interface PlainOpenings {
  sv: string;
  sr: string;
  rv: string;
  rr: string;
  lastDeposit: string | null;
  syncedLedger?: number;
}

export interface BrowserOpeningStoreOptions {
  network: string;
  dbName?: string;

  indexedDB?: IDBFactory;
}

const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const hex = (v: bigint): string => v.toString(16);
const unhex = (s: string): bigint => BigInt(`0x${s}`);

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export function toPlain(o: AccountOpenings): PlainOpenings {
  return {
    sv: hex(o.spendable.v),
    sr: hex(o.spendable.r),
    rv: hex(o.receiving.v),
    rr: hex(o.receiving.r),
    lastDeposit: o.lastDeposit === null ? null : hex(o.lastDeposit),
    ...(o.syncedLedger === undefined ? {} : { syncedLedger: o.syncedLedger }),
  };
}

export function fromPlain(p: PlainOpenings): AccountOpenings {
  return {
    spendable: { v: unhex(p.sv), r: unhex(p.sr) },
    receiving: { v: unhex(p.rv), r: unhex(p.rr) },
    lastDeposit: p.lastDeposit === null ? null : unhex(p.lastDeposit),
    ...(p.syncedLedger === undefined ? {} : { syncedLedger: p.syncedLedger }),
  };
}

export class BrowserOpeningStore implements OpeningStore {
  readonly #network: string;
  readonly #dbName: string;
  readonly #idb: IDBFactory;
  #db: Promise<IDBDatabase> | undefined;

  constructor(opts: BrowserOpeningStoreOptions) {
    this.#network = opts.network;
    this.#dbName = opts.dbName ?? "cmi-account-openings";
    this.#idb = opts.indexedDB ?? globalThis.indexedDB;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((ok, ko) => {
      const r = this.#idb.open(this.#dbName, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(STORE_OPENINGS);
        r.result.createObjectStore(STORE_META);
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return this.#db;
  }

  async #read<T>(store: string, key: string): Promise<T | undefined> {
    const db = await this.#open();
    return request<T | undefined>(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
  }

  async #write(store: string, key: string, value: unknown): Promise<void> {
    const db = await this.#open();
    await request(db.transaction(store, "readwrite").objectStore(store).put(value, key));
  }

  close(): void {
    void this.#db?.then((db) => db.close());
    this.#db = undefined;
  }

  async #wrappingKey(): Promise<CryptoKey> {
    const existing = await this.#read<CryptoKey>(STORE_META, WRAP_KEY_ID);
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await this.#write(STORE_META, WRAP_KEY_ID, key);
    return key;
  }

  wrappingKeyForTests(): Promise<CryptoKey> {
    return this.#wrappingKey();
  }

  async copyRecordForTests(account: string, tokenAddrF: Field, toAccount: string, toTokenAddrF: Field): Promise<void> {
    await this.#write(STORE_OPENINGS, this.#id(toAccount, toTokenAddrF), await this.#read(STORE_OPENINGS, this.#id(account, tokenAddrF)));
  }

  #id(account: string, tokenAddrF: Field): string {
    return `${this.#network}|${hex(toField(tokenAddrF))}|${account}`;
  }

  async get(account: string, tokenAddrF: Field): Promise<Secret<AccountOpenings> | null> {
    const id = this.#id(account, tokenAddrF);
    const record = await this.#read<StoredOpenings>(STORE_OPENINGS, id);
    if (!record) return null;
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(record.iv), additionalData: new TextEncoder().encode(id) }, await this.#wrappingKey(), buf(record.ct));
    } catch {
      throw new CmiError("BalanceOutOfSync", "the stored balance openings could not be opened in this scope");
    }
    return new Secret(fromPlain(JSON.parse(new TextDecoder().decode(plain)) as PlainOpenings));
  }

  async put(account: string, tokenAddrF: Field, openings: Secret<AccountOpenings>): Promise<void> {
    const id = this.#id(account, tokenAddrF);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(toPlain(openings.expose())));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, await this.#wrappingKey(), plaintext));
    await this.#write(STORE_OPENINGS, id, { iv, ct } satisfies StoredOpenings);
  }

  async forget(account: string, tokenAddrF: Field): Promise<void> {
    const db = await this.#open();
    await request(db.transaction(STORE_OPENINGS, "readwrite").objectStore(STORE_OPENINGS).delete(this.#id(account, tokenAddrF)));
  }
}
