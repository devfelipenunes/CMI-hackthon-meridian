import {
  CmiError,
  Secret,
  addressToField,
  buildRevokeSpenderWitness,
  cryptoRng,
  encodeRevokeSpenderData,
  ownerAllowance,
  type TxResult,
} from "@zolvency-cmi/core";

import { verifiedOpenings, withSpendable } from "../account/openings.js";
import type { BidderContext } from "./context.js";

export async function recoverCollateral(ctx: BidderContext, marketId: bigint): Promise<TxResult> {
  const me = ctx.signer.address;
  const auction = await ctx.factory.getMarketAddress(marketId);
  const delegation = await ctx.token.delegation(me, auction);
  if (delegation === null) throw new CmiError("Token.DelegationNotFound", "there is no collateral locked for this market");

  const tokenAddrF = addressToField(ctx.tokenAddress);
  const keys = await ctx.keys.get(me, tokenAddrF);
  if (keys === null) throw new CmiError("KeyNotFound", "no confidential key for this account");
  const account = await ctx.token.account(me);
  if (account === null) throw new CmiError("Token.AccountNotRegistered", "the confidential account is not registered");
  const openings = await verifiedOpenings(ctx.openings, me, tokenAddrF, account);

  const opI = addressToField(auction);
  const w = buildRevokeSpenderWitness(
    {
      keys,
      spend: new Secret(openings.expose().spendable),
      opI,
      allowance: ownerAllowance(delegation, keys, opI),
      kAudS: await ctx.token.auditorKey(account.auditorId),
    },
    ctx.rng ?? cryptoRng,
  );
  const { proof } = await ctx.prover.prove("revoke_spender", w.inputs);
  const r = await ctx.token.revokeSpender(ctx.signer, auction, encodeRevokeSpenderData(w, proof));
  await ctx.openings.put(me, tokenAddrF, withSpendable(openings, w.next.expose(), r.ledger));
  return r;
}
