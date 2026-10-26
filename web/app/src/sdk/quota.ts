import { Address, scValToNative } from "@stellar/stellar-sdk";
import { chainQuotaPort, type ChainClient } from "@zolvency-cmi/core";

import { parseSacName, type SacAsset } from "@/wallet/classic";

export async function readSacName(chain: ChainClient, asset: string): Promise<SacAsset> {
  try {
    const value = await chain.simulate(asset, "name", []);
    const name = scValToNative(value);
    if (typeof name !== "string") throw new Error("invalid asset name");
    return parseSacName(name);
  } catch {
    throw new Error("The asset could not be read. Check that the address is the SAC of a Stellar asset.");
  }
}

export async function readSacBalance(chain: ChainClient, asset: string, account: string): Promise<bigint> {
  const value = await chain.simulate(asset, "balance", [new Address(account).toScVal()]);
  const balance = scValToNative(value);
  if (typeof balance !== "bigint") throw new Error("invalid asset balance");
  return balance;
}

export async function hasQuotaTrustline(chain: ChainClient, asset: string, account: string): Promise<boolean> {
  return chainQuotaPort({ chain }).hasTrustline(asset, account);
}
