import { CmiError, addressToField, decryptIncomingTransfer, type BidStatus } from "@zolvency-cmi/core";

import type { BidderContext } from "./context.js";

export interface MyBidView {
  bidIndex: number;
  status: BidStatus;
  requested: number;
  filled: number;

  refund: bigint | null;
}

export async function bidStatus(ctx: BidderContext, marketId: bigint): Promise<MyBidView> {
  const me = ctx.signer.address;
  const address = await ctx.factory.getMarketAddress(marketId);
  const auction = ctx.auction(address);
  const count = await auction.getBidCount();
  for (let bidIndex = 0; bidIndex < count; bidIndex++) {
    const r = await auction.getBidRecord(bidIndex);
    if (r.bidder !== me) continue;
    const market = await auction.getMarket();
    const leg = (await ctx.token.spenderTransfers({ to: me, startLedger: market.params.closeLedger })).find((e) => e.spender === address && e.from === me);
    let refund: bigint | null = null;
    if (leg !== undefined) {
      const keys = await ctx.keys.get(me, addressToField(ctx.tokenAddress));
      if (keys === null) throw new CmiError("KeyNotFound", "no confidential key for this account");
      refund = decryptIncomingTransfer(leg, keys.vk).expose().vTx;
    }
    return { bidIndex, status: r.status, requested: r.requestedQuantity, filled: r.filledQuantity, refund };
  }
  throw new CmiError("Auction.BidNotFound", "this account has no bid in the market");
}
