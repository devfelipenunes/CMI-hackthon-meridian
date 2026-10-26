import { CmiError, Secret, addOpenings, addressToField, decryptIncomingTransfer, pedersenCommit } from "@zolvency-cmi/core";

import type { BidderContext } from "../bidder/context.js";

export async function receiveTransfers(ctx: BidderContext, fromLedger: number): Promise<{ transfers: number }> {
  const me = ctx.signer.address;
  const tokenAddrF = addressToField(ctx.tokenAddress);
  const keys = await ctx.keys.get(me, tokenAddrF);
  if (keys === null) throw new CmiError("KeyNotFound", "no confidential key for this account");
  const stored = await ctx.openings.get(me, tokenAddrF);
  if (stored === null) throw new CmiError("BalanceOutOfSync", "there are no stored openings for this account");
  const o = stored.expose();

  const startLedger = Math.max(fromLedger, (o.syncedLedger ?? 0) + 1);
  const events = await ctx.token.spenderTransfers({ to: me, startLedger });
  let receiving = o.receiving;
  for (const ev of events) {
    const t = decryptIncomingTransfer(ev, keys.vk).expose();
    receiving = addOpenings(receiving, { v: t.vTx, r: t.rTx });
  }

  const account = await ctx.token.account(me);
  if (account === null) throw new CmiError("Token.AccountNotRegistered", "the confidential account is not registered");
  const c = pedersenCommit(receiving.v, receiving.r);
  if (c.x !== account.receivingBalance.x || c.y !== account.receivingBalance.y) {
    throw new CmiError("BalanceOutOfSync", "the received transfers do not open the on-chain receiving balance");
  }
  const syncedLedger = events.reduce((m, e) => Math.max(m, e.ledger), o.syncedLedger ?? 0);
  await ctx.openings.put(me, tokenAddrF, new Secret({ ...o, receiving, syncedLedger }));
  ctx.logger?.info("incoming transfers received", { transfers: events.length });
  return { transfers: events.length };
}
