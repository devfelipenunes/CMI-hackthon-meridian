import type { ContractId, MarketParams, TxResult } from "@zolvency-cmi/core";

import { cancelMarket } from "./cancel.js";
import type { SellerContext } from "./context.js";
import { createMarket, type RegisterDataProvider } from "./create.js";
import { openMarket } from "./open.js";
import { proceeds, type Proceed } from "./proceeds.js";

export type { SellerContext } from "./context.js";
export { checkMarketParams, type RegisterDataProvider } from "./create.js";
export type { Proceed } from "./proceeds.js";

export class SellerApi {
  readonly #ctx: SellerContext;

  constructor(ctx: SellerContext) {
    this.#ctx = ctx;
  }

  createMarket(params: MarketParams, provider: RegisterDataProvider, opts?: { maxAttempts?: number }): Promise<{ marketId: bigint; address: ContractId }> {
    return createMarket(this.#ctx, params, provider, opts);
  }

  openMarket(marketId: bigint): Promise<TxResult> {
    return openMarket(this.#ctx, marketId);
  }

  cancelMarket(marketId: bigint): Promise<TxResult> {
    return cancelMarket(this.#ctx, marketId);
  }

  proceeds(marketId: bigint): Promise<Proceed[]> {
    return proceeds(this.#ctx, marketId);
  }
}
