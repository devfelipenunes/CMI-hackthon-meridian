import { CmiError, type TxResult } from "@zolvency-cmi/core";

import { auctionOf, type SellerContext } from "./context.js";

export async function openMarket(ctx: SellerContext, marketId: bigint): Promise<TxResult> {
  const auction = await auctionOf(ctx, marketId);
  if ((await auction.getState()) !== "Created") throw new CmiError("Auction.InvalidState", "only a Created market can be opened");
  return auction.openMarket(ctx.signer);
}
