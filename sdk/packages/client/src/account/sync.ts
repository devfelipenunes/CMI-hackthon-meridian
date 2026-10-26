import {
  CmiError,
  Secret,
  addOpenings,
  addressToField,
  decryptIncomingTransfer,
  openSpendableBalance,
  type Opening,
  type TokenAccountEvent,
  type TokenKeys,
} from "@zolvency-cmi/core";

import type { BidderContext } from "../bidder/context.js";
import { opensOnChain, type AccountOpenings } from "./openings.js";

export type SyncSource = "stored" | "checkpoint" | "events";

export interface SyncResult {
  source: SyncSource;

  events: number;

  syncedLedger: number | null;
}

const ZERO: Opening = { v: 0n, r: 0n };

export function replayAccountEvents(events: readonly TokenAccountEvent[], keys: TokenKeys, start: AccountOpenings | null): AccountOpenings | null {
  let spendable: Opening | null = start?.spendable ?? null;
  let receiving: Opening | null = start?.receiving ?? null;
  let lastDeposit: bigint | null = start?.lastDeposit ?? null;
  for (const e of events) {
    switch (e.kind) {
      case "registered":
        spendable = ZERO;
        receiving = ZERO;
        lastDeposit = null;
        break;
      case "deposited":
        receiving = receiving && addOpenings(receiving, { v: e.amount, r: 0n });
        lastDeposit = e.amount;
        break;
      case "merged":
        spendable = spendable && receiving && addOpenings(spendable, receiving);
        receiving = ZERO;
        break;
      case "spendableSet":
        spendable = openSpendableBalance({ bTilde: e.bTilde, sigma: e.sigma }, keys).expose();
        break;
      case "received": {
        const t = decryptIncomingTransfer(e, keys.vk).expose();
        receiving = receiving && addOpenings(receiving, { v: t.vTx, r: t.rTx });
        break;
      }
    }
  }
  return spendable && receiving ? { spendable, receiving, lastDeposit } : null;
}

export async function syncAccount(ctx: BidderContext, opts: { fromLedger?: number } = {}): Promise<SyncResult> {
  const me = ctx.signer.address;
  const tokenAddrF = addressToField(ctx.tokenAddress);
  const keys = await ctx.keys.get(me, tokenAddrF);
  if (keys === null) throw new CmiError("KeyNotFound", "no confidential key for this account");
  const account = await ctx.token.account(me);
  if (account === null) throw new CmiError("Token.AccountNotRegistered", "the confidential account is not registered");

  let stored: AccountOpenings | null = null;
  try {
    stored = (await ctx.openings.get(me, tokenAddrF))?.expose() ?? null;
  } catch {
    stored = null;
  }
  if (stored !== null && opensOnChain(stored, account)) return { source: "stored", events: 0, syncedLedger: stored.syncedLedger ?? null };

  const accept = async (o: AccountOpenings | null, toLedger: number, source: SyncSource, events: number): Promise<SyncResult | null> => {
    if (o === null || !opensOnChain(o, account)) return null;
    await ctx.openings.put(me, tokenAddrF, new Secret({ ...o, syncedLedger: toLedger }));
    ctx.logger?.info("balance openings synced", { source, events });
    return { source, events, syncedLedger: toLedger };
  };

  if (stored?.syncedLedger !== undefined && opts.fromLedger === undefined) {
    const startLedger = stored.syncedLedger + 1;
    const page = await ctx.token.accountEvents({ account: me, startLedger });

    if (page.fromLedger === startLedger) {
      const done = await accept(replayAccountEvents(page.events, keys, stored), page.toLedger, "checkpoint", page.events.length);
      if (done !== null) return done;
    }
  }

  const page = await ctx.token.accountEvents({ account: me, startLedger: opts.fromLedger ?? 0 });
  const done = await accept(replayAccountEvents(page.events, keys, null), page.toLedger, "events", page.events.length);
  if (done !== null) return done;
  throw new CmiError("BalanceOutOfSync", "the balance openings could not be rebuilt from the events the RPC still keeps; import a more recent backup");
}
