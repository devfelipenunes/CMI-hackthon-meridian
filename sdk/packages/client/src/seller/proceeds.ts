import { CmiError, addressToField, decryptIncomingTransfer } from "@zolvency-cmi/core";

import { auctionOf, type SellerContext } from "./context.js";

export interface Proceed {
  bidIndex: number;
  filled: number;
  received: bigint | null;
}

export async function proceeds(ctx: SellerContext, marketId: bigint): Promise<Proceed[]> {
  const { token, keys, tokenAddress } = ctx;
  if (token === undefined || keys === undefined || tokenAddress === undefined) throw new TypeError("SellerApi.proceeds needs token, keys and tokenAddress in the context");
  const me = ctx.signer.address;
  const sk = await keys.get(me, addressToField(tokenAddress));
  if (sk === null) throw new CmiError("KeyNotFound", "no confidential key for this account");

  const auction = await auctionOf(ctx, marketId);
  const market = await auction.getMarket();
  const legs = (await token.spenderTransfers({ to: me, startLedger: market.params.closeLedger })).filter((e) => e.spender === auction.address);
  const out: Proceed[] = [];
  const count = await auction.getBidCount();
  for (let bidIndex = 0; bidIndex < count; bidIndex++) {
    const r = await auction.getBidRecord(bidIndex);
    if (r.filledQuantity === 0) continue;
    const leg = legs.find((e) => e.from === r.bidder);
    if (leg === undefined) {
      if (r.status === "Settled") out.push({ bidIndex, filled: r.filledQuantity, received: null });
      continue;
    }
    out.push({ bidIndex, filled: r.filledQuantity, received: decryptIncomingTransfer(leg, sk.vk).expose().vTx });
  }
  return out;
}
