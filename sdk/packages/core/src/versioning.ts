import { AUCTION_WASM_SHA256 } from "./bindings/auction.js";
import type { ChainClient } from "./chain/client.js";
import type { ContractId } from "./chain/events.js";
import { CmiError } from "./errors/CmiError.js";

export interface ContractsVersion {

  auctionWasmSha256: string;

  releases: readonly string[];
}

export const CONTRACTS_VERSIONS: readonly ContractsVersion[] = Object.freeze([
  Object.freeze({ auctionWasmSha256: AUCTION_WASM_SHA256, releases: Object.freeze(["v0.1.0-rc.4", "v0.1.0"]) }),
]);

export function contractsVersionOf(auctionWasmSha256: string): ContractsVersion {
  const v = CONTRACTS_VERSIONS.find((x) => x.auctionWasmSha256 === auctionWasmSha256.toLowerCase());
  if (v === undefined) throw new CmiError("UnsupportedContractsVersion", "this market runs an Auction version this SDK does not support");
  return v;
}

export async function marketVersion(chain: ChainClient, auction: ContractId): Promise<ContractsVersion> {
  return contractsVersionOf(await chain.contractWasmHash(auction));
}
