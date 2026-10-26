import type { TxResult } from "@zolvency-cmi/core";

import type { BidderContext } from "./context.js";
import { placeBid } from "./place.js";
import { prepareBid, type PreparedBid } from "./prepare.js";
import { recoverCollateral } from "./recover.js";
import { bidStatus, type MyBidView } from "./status.js";

export type { BidderContext } from "./context.js";
export { bidLiveUntil, type BidWarning, type PreparedBid } from "./prepare.js";
export { preflight, type Preflight } from "./preflight.js";
export type { MyBidView } from "./status.js";

export class BidderApi {
  readonly #ctx: BidderContext;

  constructor(ctx: BidderContext) {
    this.#ctx = ctx;
  }

  prepareBid(marketId: bigint, price: bigint, quantity: number): Promise<PreparedBid> {
    return prepareBid(this.#ctx, marketId, price, quantity);
  }

  placeBid(p: PreparedBid): Promise<{ bidIndex: number }> {
    return placeBid(this.#ctx, p);
  }

  recoverCollateral(marketId: bigint): Promise<TxResult> {
    return recoverCollateral(this.#ctx, marketId);
  }

  status(marketId: bigint): Promise<MyBidView> {
    return bidStatus(this.#ctx, marketId);
  }
}
