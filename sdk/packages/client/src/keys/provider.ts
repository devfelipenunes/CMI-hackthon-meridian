import type { Field, TokenKeys } from "@zolvency-cmi/core";

export interface ConfidentialKeyProvider {
  get(account: string, tokenAddrF: Field): Promise<TokenKeys | null>;

  create(account: string, tokenAddrF: Field): Promise<TokenKeys>;
}
