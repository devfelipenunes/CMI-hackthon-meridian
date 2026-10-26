import {
  CmiError,
  MAX_DURATION_LEDGERS,
  MIN_FEE_RESERVE,
  PRICE_MAX_EXCLUSIVE,
  type CmiErrorCode,
  type ContractId,
  type MarketParams,
} from "@zolvency-cmi/core";

import type { SellerContext } from "./context.js";

export interface RegisterDataProvider {
  forNextMarket(): Promise<{ marketId: bigint; address: ContractId; registerData: Uint8Array }>;
}

export function checkMarketParams(p: MarketParams, ledger: number): void {
  const fail = (code: CmiErrorCode, why: string): never => {
    throw new CmiError(code, why);
  };
  if (p.totalQuotas === 0) fail("Factory.InvalidTotalQuotas", "total_quotas must be > 0");
  if (p.minPricePerQuota === 0n || p.minPricePerQuota >= PRICE_MAX_EXCLUSIVE) fail("Factory.InvalidMinPrice", "min price must be in (0, 2^63)");
  if (p.closeLedger <= ledger) fail("Factory.InvalidCloseLedger", "close_ledger must be in the future");
  if (p.closeLedger - ledger > MAX_DURATION_LEDGERS) fail("Factory.DurationTooLong", "the market can last at most 30 days");
  if (p.feeReserve < MIN_FEE_RESERVE) fail("Factory.InvalidFeeReserve", "fee_reserve must be at least 5 XLM");
}

export async function createMarket(
  ctx: SellerContext,
  params: MarketParams,
  provider: RegisterDataProvider,
  opts: { maxAttempts?: number } = {},
): Promise<{ marketId: bigint; address: ContractId }> {
  checkMarketParams(params, await ctx.clock.ledger());
  const attempts = opts.maxAttempts ?? 3;
  for (let i = 1; ; i++) {
    const { registerData } = await provider.forNextMarket();
    try {
      return await ctx.factory.createMarket(ctx.signer, params, registerData);
    } catch (e) {
      if (!(e instanceof CmiError) || e.code !== "ResourceContention" || i >= attempts) throw e;
    }
  }
}
