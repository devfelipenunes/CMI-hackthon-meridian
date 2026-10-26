import {
  CmiError,
  Secret,
  cryptoRng,
  deriveTokenKeys,
  fromBytes32BE,
  toBytes32BE,
  toField,
  type Field,
  type Rng,
  type TokenKeys,
} from "@zolvency-cmi/core";

import { fromPlain, toPlain, type PlainOpenings } from "../account/browser-store.js";
import type { AccountOpenings } from "../account/openings.js";
import type { ConfidentialKeyProvider } from "./provider.js";

const STORE_KEYS = "keys";
const STORE_META = "meta";
const WRAP_KEY_ID = "wrapping-key";
const BACKUP_PREFIX = "cmi-key-backup:v1:";
const BACKUP_AAD = new TextEncoder().encode("cmi-key-backup:v1");
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSWORD = 12;

interface StoredKey {
  iv: Uint8Array;
  ct: Uint8Array;
  backedUp: boolean;
}

export interface BrowserKeyProviderOptions {
  network: string;
  dbName?: string;
  rng?: Rng;

  indexedDB?: IDBFactory;
}

const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => buf(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const hex = (v: bigint): string => v.toString(16);

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export class BrowserKeyProvider implements ConfidentialKeyProvider {
  readonly #network: string;
  readonly #dbName: string;
  readonly #rng: Rng;
  readonly #idb: IDBFactory;
  #db: Promise<IDBDatabase> | undefined;

  constructor(opts: BrowserKeyProviderOptions) {
    this.#network = opts.network;
    this.#dbName = opts.dbName ?? "cmi-confidential-keys";
    this.#rng = opts.rng ?? cryptoRng;
    this.#idb = opts.indexedDB ?? globalThis.indexedDB;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((ok, ko) => {
      const r = this.#idb.open(this.#dbName, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(STORE_KEYS);
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

  async #delete(store: string, key: string): Promise<void> {
    const db = await this.#open();
    await request(db.transaction(store, "readwrite").objectStore(store).delete(key));
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

  #id(account: string, tokenAddrF: Field): string {
    return `${this.#network}|${hex(toField(tokenAddrF))}|${account}`;
  }

  async #store(id: string, sk: bigint, backedUp: boolean): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, await this.#wrappingKey(), buf(toBytes32BE(sk))),
    );
    await this.#write(STORE_KEYS, id, { iv, ct, backedUp } satisfies StoredKey);
  }

  async #loadSk(id: string): Promise<{ sk: bigint; record: StoredKey } | null> {
    const record = await this.#read<StoredKey>(STORE_KEYS, id);
    if (!record) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(record.iv), additionalData: new TextEncoder().encode(id) },
      await this.#wrappingKey(),
      buf(record.ct),
    );
    return { sk: fromBytes32BE(new Uint8Array(plain)), record };
  }

  async get(account: string, tokenAddrF: Field): Promise<TokenKeys | null> {
    const loaded = await this.#loadSk(this.#id(account, tokenAddrF));
    return loaded ? deriveTokenKeys(loaded.sk, tokenAddrF) : null;
  }

  async create(account: string, tokenAddrF: Field): Promise<TokenKeys> {
    const id = this.#id(account, tokenAddrF);
    if (await this.#read(STORE_KEYS, id)) throw new CmiError("KeyAlreadyExists", "a confidential key already exists for this account");
    const keys = deriveTokenKeys(this.#rng.scalar(), tokenAddrF);
    await this.#store(id, keys.sk.expose(), false);
    return keys;
  }

  async backupStatus(account: string, tokenAddrF: Field): Promise<{ backupRequired: boolean }> {
    const record = await this.#read<StoredKey>(STORE_KEYS, this.#id(account, tokenAddrF));
    if (!record) throw new CmiError("KeyNotFound", "no confidential key for this account");
    return { backupRequired: !record.backedUp };
  }

  async markBackedUp(account: string, tokenAddrF: Field): Promise<void> {
    const id = this.#id(account, tokenAddrF);
    const record = await this.#read<StoredKey>(STORE_KEYS, id);
    if (!record) throw new CmiError("KeyNotFound", "no confidential key for this account");
    await this.#write(STORE_KEYS, id, { ...record, backedUp: true });
  }

  async forget(account: string, tokenAddrF: Field): Promise<void> {
    await this.#delete(STORE_KEYS, this.#id(account, tokenAddrF));
  }

  async exportBackup(account: string, tokenAddrF: Field, password: string, opts: { openings?: Secret<AccountOpenings> } = {}): Promise<string> {
    if (password.length < MIN_PASSWORD) throw new RangeError(`backup password must have at least ${MIN_PASSWORD} characters`);
    const loaded = await this.#loadSk(this.#id(account, tokenAddrF));
    if (!loaded) throw new CmiError("KeyNotFound", "no confidential key for this account");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        network: this.#network,
        account,
        tokenAddrF: hex(tokenAddrF),
        sk: hex(loaded.sk),
        ...(opts.openings === undefined ? {} : { openings: toPlain(opts.openings.expose()) }),
      }),
    );
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: BACKUP_AAD }, await passwordKey(password, salt), plaintext),
    );
    const envelope = { v: 1, kdf: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
    return BACKUP_PREFIX + btoa(JSON.stringify(envelope));
  }

  async importBackup(backup: string, password: string): Promise<{ account: string; tokenAddrF: Field; openings: Secret<AccountOpenings> | null }> {
    let data: { network: string; account: string; tokenAddrF: string; sk: string; openings?: PlainOpenings };
    try {
      if (!backup.startsWith(BACKUP_PREFIX)) throw new Error("prefix");
      const env = JSON.parse(atob(backup.slice(BACKUP_PREFIX.length))) as { iterations: number; salt: string; iv: string; ct: string };
      if (env.iterations !== PBKDF2_ITERATIONS) throw new Error("kdf");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(env.iv), additionalData: BACKUP_AAD },
        await passwordKey(password, unb64(env.salt)),
        unb64(env.ct),
      );
      data = JSON.parse(new TextDecoder().decode(plain));
      if (data.network !== this.#network) throw new Error("network");
    } catch {
      throw new CmiError("InvalidBackup", "the backup could not be opened (wrong password, other network or corrupted text)");
    }
    const tokenAddrF = BigInt(`0x${data.tokenAddrF}`);
    const sk = BigInt(`0x${data.sk}`);
    deriveTokenKeys(sk, tokenAddrF);
    await this.#store(this.#id(data.account, tokenAddrF), sk, true);
    return { account: data.account, tokenAddrF, openings: data.openings === undefined ? null : new Secret(fromPlain(data.openings)) };
  }
}

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
