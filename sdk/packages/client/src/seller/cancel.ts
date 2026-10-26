import type { TxResult } from "@zolvency-cmi/core";

import { auctionOf, type SellerContext } from "./context.js";

export async function cancelMarket(ctx: SellerContext, marketId: bigint): Promise<TxResult> {
  return (await auctionOf(ctx, marketId)).cancelMarket(ctx.signer);
}
