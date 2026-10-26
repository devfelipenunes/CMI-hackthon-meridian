import { AUCTION_ERRORS, FACTORY_ERRORS, TOKEN_ERRORS, type CmiErrorCode } from "./codes.js";

export type ContractErrorDomain = "Auction" | "Factory";

const lookup = <T extends Record<number, string>>(table: T, n: number): T[keyof T] | undefined =>
  Object.hasOwn(table, n) ? (table[n as keyof T] as T[keyof T]) : undefined;

export function contractErrorCode(n: number, domain?: ContractErrorDomain): CmiErrorCode | null {
  const token = lookup(TOKEN_ERRORS, n);
  if (token !== undefined) return `Token.${token}`;
  if (domain === "Auction") {
    const name = lookup(AUCTION_ERRORS, n);
    if (name !== undefined) return `Auction.${name}`;
  }
  if (domain === "Factory") {
    const name = lookup(FACTORY_ERRORS, n);
    if (name !== undefined) return `Factory.${name}`;
  }
  return null;
}
