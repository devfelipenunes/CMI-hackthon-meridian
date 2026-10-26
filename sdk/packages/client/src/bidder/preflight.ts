import {
  CmiError,
  MAX_BIDS,
  addressToField,
  assertPriceRange,
  type AuctionPort,
  type MarketConfig,
  type OnChainAccount,
  type Secret,
  type TokenKeys,
} from "@zolvency-cmi/core";

import { verifiedOpenings, type AccountOpenings } from "../account/openings.js";
import type { BidderContext } from "./context.js";

export interface Preflight {
  auction: AuctionPort;
  config: MarketConfig;

  participantId: number | null;
  keys: TokenKeys;
  account: OnChainAccount;
  openings: Secret<AccountOpenings>;
}

const fail = (code: ConstructorParameters<typeof CmiError>[0], why: string, recovery?: "change_trust"): never => {
  throw new CmiError(code, why, recovery === undefined ? {} : { recovery });
};

export async function preflight(ctx: BidderContext, marketId: bigint, price: bigint, quantity: number): Promise<Preflight> {
  try {
    assertPriceRange(price);
  } catch {
    fail("PriceOutOfRange", "price must be in (0, 2^63)");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) fail("Auction.ZeroQuantity", "requested quantity must be a positive integer");

  const auction = ctx.auction(await ctx.factory.getMarketAddress(marketId));
  const config = await auction.getMarket();
  if (price < config.params.minPricePerQuota) fail("BelowMinPrice", "price is below the market minimum");

  if ((await auction.getState()) !== "Open") fail("MarketNotOpen", "the market is not open");
  if ((await ctx.clock.ledger()) >= config.params.closeLedger) fail("BiddingClosed", "bidding is closed");
  const count = await auction.getBidCount();
  if (count >= MAX_BIDS) fail("MarketFull", "the market already has the maximum number of bids");

  const me = ctx.signer.address;
  const participantId = await auction.getParticipantId(me);
  if (participantId !== null) {
    for (let i = 0; i < count; i++) if ((await auction.getBidRecord(i)).bidder === me) fail("AlreadyBid", "this account already has a bid in this market");
  }

  if (!(await ctx.quota.hasTrustline(config.params.quotaAsset, me))) fail("NoTrustline", "add a trustline for the quota asset first", "change_trust");

  const tokenAddrF = addressToField(ctx.tokenAddress);
  const keys = await ctx.keys.get(me, tokenAddrF);
  if (keys === null) return fail("KeyNotFound", "no confidential key for this account");
  const account = await ctx.token.account(me);
  if (account === null) return fail("Token.AccountNotRegistered", "the confidential account is not registered");
  const openings = await verifiedOpenings(ctx.openings, me, tokenAddrF, account);
  if (openings.expose().spendable.v < price * BigInt(quantity)) fail("InsufficientBalance", "spendable balance is below price × quantity");

  return { auction, config, participantId, keys, account, openings };
}
