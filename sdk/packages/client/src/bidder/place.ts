import { CmiError, addressToField, silentLogger } from "@zolvency-cmi/core";

import { verifiedOpenings, withSpendable } from "../account/openings.js";
import type { BidderContext } from "./context.js";
import type { PreparedBid } from "./prepare.js";

const same = (a: { x: bigint; y: bigint }, b: { x: bigint; y: bigint }): boolean => a.x === b.x && a.y === b.y;

function afterLock(e: unknown): never {
  if (e instanceof CmiError) throw new CmiError(e.code, e.message.replace(/^[^:]+: /, ""), { recovery: "revoke_spender" });
  throw e;
}

export async function placeBid(ctx: BidderContext, p: PreparedBid): Promise<{ bidIndex: number }> {
  const log = ctx.logger ?? silentLogger;
  const me = ctx.signer.address;
  const existing = await ctx.token.delegation(me, p.auction);

  if (existing === null) {
    const tokenAddrF = addressToField(ctx.tokenAddress);
    const account = await ctx.token.account(me);
    if (account === null) throw new CmiError("Token.AccountNotRegistered", "the confidential account is not registered");
    const openings = await verifiedOpenings(ctx.openings, me, tokenAddrF, account);
    const locked = await ctx.token.setSpender(ctx.signer, p.auction, p.setSpender.liveUntilLedger, p.setSpender.data);
    await ctx.openings.put(me, tokenAddrF, withSpendable(openings, p.secrets.expose().next, locked.ledger));
    log.info("collateral locked", { marketId: p.marketId.toString(), liveUntilLedger: p.setSpender.liveUntilLedger });
  } else if (!same(existing.allowanceCommitment, p.setSpender.cA)) {
    throw new CmiError("Token.DelegationAlreadyExists", "a different collateral is already locked for this market: revoke it first (recoverCollateral)", {
      recovery: "revoke_spender",
    });
  }

  try {
    const onChain = await ctx.token.delegation(me, p.auction);
    if (onChain === null || !same(onChain.allowanceCommitment, p.setSpender.cA)) {
      throw new CmiError("CollateralMismatch", "the locked collateral is not the prepared one");
    }
    const bidIndex = await ctx.auction(p.auction).submitBid(ctx.signer, p.submission);
    log.info("bid accepted", { marketId: p.marketId.toString(), bidIndex });
    return { bidIndex };
  } catch (e) {
    return afterLock(e);
  }
}
