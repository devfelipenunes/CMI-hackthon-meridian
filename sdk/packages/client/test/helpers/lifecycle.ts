import { Keypair } from "@stellar/stellar-sdk";
import {
  Secret,
  TOKEN_H,
  addressToField,
  buildSpenderTransferWitness,
  encodeSpenderTransferData,
  keypairSigner,
  type Signer,
  type TxResult,
} from "@zolvency-cmi/core";
import { SeededRng } from "@zolvency-cmi/testing";

import { AccountApi, BidderApi, MemoryOpeningStore, type BidderContext } from "../../src/index.js";
import { QUOTA, bidderScenario } from "./bidder.js";

export const DEPOSIT = 300_000n;
export const PRICE = 580n;
export const QTY = 400;
export const REFUND = 58_000n;
export const LEDGER = { register: 100, deposit: 110, bid: 120, refund: 1_000 } as const;

export async function accountLifecycle(o: { refund?: boolean } = {}) {
  const s = await bidderScenario();
  const me: Signer = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).secret());
  s.quota.addTrustline(QUOTA, me.address);
  const openings = new MemoryOpeningStore();
  const ctx: BidderContext = { ...s.ctx, signer: me, openings };
  const account = new AccountApi(ctx);
  const bidder = new BidderApi(ctx);
  const tokenAddrF = addressToField(ctx.tokenAddress);
  const tx: Record<string, TxResult> = {};

  s.clock.advanceTo(LEDGER.register);
  const { keys } = await account.ensureRegistered();
  s.clock.advanceTo(LEDGER.deposit);
  tx.deposit = await account.deposit(DEPOSIT);
  tx.merge = await account.merge();
  s.clock.advanceTo(LEDGER.bid);
  const prepared = await bidder.prepareBid(s.marketId, PRICE, QTY);
  await bidder.placeBid(prepared);

  if (o.refund ?? true) {

    s.clock.advanceTo(LEDGER.refund);
    const sigmaA = s.token.delegations.get(`${me.address}|${s.address}`)!.allowanceSalt;
    const w = buildSpenderTransferWitness(
      { skOp: new Secret(5n), yOp: TOKEN_H, allowance: new Secret({ dvk: 77n, vA: PRICE * BigInt(QTY), rA: 0n, sigmaA }), vTx: REFUND, pvkRecipient: keys.PVK, kAudR: TOKEN_H, kAudS: TOKEN_H },
      new SeededRng("refund"),
    );
    const auctionSigner = { address: s.address, signTransaction: async (x: string) => x } as Signer;
    await s.token.spenderTransfer(auctionSigner, me.address, me.address, encodeSpenderTransferData(w, new Uint8Array(14_592)));
  }
  s.log.clear();
  return { ...s, me, ctx, account, bidder, openings, tokenAddrF, keys, tx };
}

export function freshBrowser(l: Awaited<ReturnType<typeof accountLifecycle>>) {
  const openings = new MemoryOpeningStore();
  return { openings, account: new AccountApi({ ...l.ctx, openings }) };
}
