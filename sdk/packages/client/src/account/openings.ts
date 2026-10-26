import { CmiError, Secret, pedersenCommit, type Field, type Opening, type Point } from "@zolvency-cmi/core";

export interface AccountOpenings {
  spendable: Opening;
  receiving: Opening;

  lastDeposit: bigint | null;

  syncedLedger?: number;
}

export interface OpeningStore {
  get(account: string, tokenAddrF: Field): Promise<Secret<AccountOpenings> | null>;
  put(account: string, tokenAddrF: Field, openings: Secret<AccountOpenings>): Promise<void>;
}

export class MemoryOpeningStore implements OpeningStore {
  readonly #map = new Map<string, Secret<AccountOpenings>>();

  async get(account: string, tokenAddrF: Field): Promise<Secret<AccountOpenings> | null> {
    return this.#map.get(`${tokenAddrF}|${account}`) ?? null;
  }

  async put(account: string, tokenAddrF: Field, openings: Secret<AccountOpenings>): Promise<void> {
    this.#map.set(`${tokenAddrF}|${account}`, openings);
  }
}

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

export function opensOnChain(o: AccountOpenings, onChain: { spendableBalance: Point; receivingBalance: Point }): boolean {
  return same(pedersenCommit(o.spendable.v, o.spendable.r), onChain.spendableBalance) && same(pedersenCommit(o.receiving.v, o.receiving.r), onChain.receivingBalance);
}

export async function verifiedOpenings(
  store: OpeningStore,
  account: string,
  tokenAddrF: Field,
  onChain: { spendableBalance: Point; receivingBalance: Point },
): Promise<Secret<AccountOpenings>> {
  const o = await store.get(account, tokenAddrF);
  if (o === null || !opensOnChain(o.expose(), onChain)) throw new CmiError("BalanceOutOfSync", "the stored balance opening does not match the on-chain commitment");
  return o;
}

export const withSpendable = (o: Secret<AccountOpenings>, spendable: Opening, syncedLedger: number): Secret<AccountOpenings> =>
  new Secret({ ...o.expose(), spendable, syncedLedger });
