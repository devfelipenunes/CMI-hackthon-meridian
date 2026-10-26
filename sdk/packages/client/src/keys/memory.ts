import { CmiError, cryptoRng, deriveTokenKeys, generateTokenKeys, type Field, type Rng, type TokenKeys } from "@zolvency-cmi/core";

import type { ConfidentialKeyProvider } from "./provider.js";

export class InMemoryKeyProvider implements ConfidentialKeyProvider {
  readonly #rng: Rng;
  readonly #keys = new Map<string, bigint>();

  constructor(opts: { rng?: Rng } = {}) {
    this.#rng = opts.rng ?? cryptoRng;
  }

  async get(account: string, tokenAddrF: Field): Promise<TokenKeys | null> {
    const sk = this.#keys.get(`${tokenAddrF}|${account}`);
    return sk === undefined ? null : deriveTokenKeys(sk, tokenAddrF);
  }

  async create(account: string, tokenAddrF: Field): Promise<TokenKeys> {
    const id = `${tokenAddrF}|${account}`;
    if (this.#keys.has(id)) throw new CmiError("KeyAlreadyExists", "a confidential key already exists for this account");
    const keys = generateTokenKeys(tokenAddrF, this.#rng);
    this.#keys.set(id, keys.sk.expose());
    return keys;
  }
}
