import type { AuctionPort, Clock, ContractId, FactoryPort, Signer, TokenPort } from "@zolvency-cmi/core";

import type { ConfidentialKeyProvider } from "../keys/provider.js";

export interface SellerContext {
  signer: Signer;
  factory: FactoryPort;
  auction(address: ContractId): AuctionPort;
  clock: Clock;

  token?: TokenPort;
  keys?: ConfidentialKeyProvider;
  tokenAddress?: ContractId;
}

export async function auctionOf(ctx: Pick<SellerContext, "factory" | "auction">, marketId: bigint): Promise<AuctionPort> {
  return ctx.auction(await ctx.factory.getMarketAddress(marketId));
}
