import { Keypair } from "@stellar/stellar-sdk";
import {
  BID_VALIDITY_PK_OPERATOR,
  FR_MODULUS,
  GRUMPKIN_G,
  Secret,
  TOKEN_H,
  cryptoRng,
  keypairSigner,
  pointToBytes,
  scalarMul,
  type Point,
  type Scalar,
  type Signer,
} from "@zolvency-cmi/core";
import type { OperatorKeyStore } from "@zolvency-cmi/operator";

import type { KeyRepo } from "../db/repos.js";
import { ServiceError } from "../errors.js";
import { seal, unseal } from "./seal.js";

export const KEY_NAMES = ["spender", "envelope", "submitter", "fee_wallet_stellar", "fee_wallet_token", "admin"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export const SCALAR_KEYS: readonly KeyName[] = ["spender", "envelope", "fee_wallet_token"];
export const ACCOUNT_KEYS: readonly KeyName[] = ["submitter", "fee_wallet_stellar", "admin"];

export const POC_ENVELOPE_SCALAR = 987_654_321_098n;

export function isKeyName(s: string): s is KeyName {
  return (KEY_NAMES as readonly string[]).includes(s);
}

export function pointHex(p: Point): string {
  return Buffer.from(pointToBytes(p)).toString("hex");
}

export function auditorKeyHex(spender: Scalar): string {
  return pointHex(scalarMul(spender, TOKEN_H));
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function parseScalar(text: string): Scalar {
  const t = text.trim();
  if (!/^(0x)?[0-9a-fA-F]{1,64}$/.test(t)) throw new ServiceError("ConfigInvalid", "a scalar must be hex");
  const k = BigInt(t.startsWith("0x") ? t : `0x${t}`);
  if (k <= 0n || k >= FR_MODULUS) throw new ServiceError("ConfigInvalid", "a scalar must be in [1, r)");
  return k;
}

export function publicPart(name: KeyName, plaintext: string, opts: { feeWalletAddress?: string } = {}): string {
  if (ACCOUNT_KEYS.includes(name)) return Keypair.fromSecret(plaintext).publicKey();
  const k = parseScalar(plaintext);
  if (name === "spender") return auditorKeyHex(k);
  if (name === "envelope") return pointHex(scalarMul(k, GRUMPKIN_G));
  return opts.feeWalletAddress ?? "confidential-key";
}

export function normalizeKey(name: KeyName, text: string): string {
  if (ACCOUNT_KEYS.includes(name)) {
    const t = text.trim();
    try {
      Keypair.fromSecret(t);
    } catch {
      throw new ServiceError("ConfigInvalid", `${name} must be a Stellar secret (S...)`);
    }
    return t;
  }
  const k = parseScalar(text);
  if (name === "envelope" && !samePoint(scalarMul(k, GRUMPKIN_G), BID_VALIDITY_PK_OPERATOR)) {
    throw new ServiceError("EnvelopeKeyMismatch", "the envelope key does not match the PK_operator of the bid_validity circuit");
  }
  return k.toString(16);
}

export function generateKey(name: KeyName): string {
  if (name === "envelope") throw new ServiceError("EnvelopeKeyMismatch", "the envelope key is fixed by the circuit: import it (keys import envelope --poc)");
  if (ACCOUNT_KEYS.includes(name)) return Keypair.random().secret();
  return cryptoRng.scalar().toString(16);
}

export class DbOperatorKeyStore implements OperatorKeyStore {
  readonly #repo: KeyRepo;
  readonly #master: Secret<Buffer>;

  constructor(repo: KeyRepo, master: Secret<Buffer>) {
    this.#repo = repo;
    this.#master = master;
  }

  has(name: KeyName): boolean {
    return this.#repo.get(name) !== null;
  }

  publicOf(name: KeyName): string {
    const r = this.#repo.get(name);
    if (r === null) throw new ServiceError("KeyNotFound", `key "${name}" not found (pnpm cli keys generate|import ${name})`);
    return r.public;
  }

  put(name: KeyName, text: Secret<string>, opts: { feeWalletAddress?: string } = {}): string {
    const plain = normalizeKey(name, text.expose());
    const pub = publicPart(name, plain, opts);
    const ok = this.#repo.insert({ name, public: pub, ...seal(this.#master, name, new Secret(plain)) });
    if (!ok) throw new ServiceError("KeyAlreadyExists", `key "${name}" already exists`);
    return pub;
  }

  read(name: KeyName): Secret<string> {
    const r = this.#repo.get(name);
    if (r === null) throw new ServiceError("KeyNotFound", `key "${name}" not found (pnpm cli keys generate|import ${name})`);
    return unseal(this.#master, name, r);
  }

  scalar(name: KeyName): Secret<Scalar> {
    return new Secret(parseScalar(this.read(name).expose()));
  }

  signer(name: KeyName): Signer {
    return keypairSigner(this.read(name).expose());
  }

  async spenderKey(): Promise<Secret<Scalar>> {
    return this.scalar("spender");
  }

  async envelopeKey(): Promise<Secret<Scalar>> {
    return this.scalar("envelope");
  }

  async submitter(): Promise<Signer> {
    return this.signer("submitter");
  }
}
