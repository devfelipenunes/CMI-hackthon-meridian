import { Keypair } from "@stellar/stellar-sdk";
import {
  FINALIZATION_GRACE_LEDGERS,
  Secret,
  TOKEN_H,
  buildSpenderTransferWitness,
  encodeSpenderTransferData,
  keypairSigner,
  settlementAmounts,
  type AllowanceState,
  type Point,
  type Signer,
} from "@zolvency-cmi/core";
import { FAKE_PLATFORM, SeededRng, fakeBidRecord } from "@zolvency-cmi/testing";

import { AccountApi, SellerApi } from "../../src/index.js";
import { CLOSE, bidderScenario } from "./bidder.js";

const signer = (seed: number): Signer => keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)).secret());
const SIGMA_A = 999_001n;

export async function settledAurora() {
  const s = await bidderScenario();
  const rng = new SeededRng("settled");
  const seller = signer(6);
  const sellerKeys = await s.keys.create(seller.address, s.tokenAddrF);
  s.token.registerAccount(seller.address, sellerKeys.Y, undefined, sellerKeys.PVK);
  const fee = await s.keys.create(FAKE_PLATFORM.feeWallet, s.tokenAddrF);
  s.token.registerAccount(FAKE_PLATFORM.feeWallet, fee.Y, undefined, fee.PVK);

  const bids = [
    { who: signer(11).address, price: 650n, quantity: 200, filled: 200 },
    { who: signer(12).address, price: 600n, quantity: 500, filled: 500 },
    { who: s.me.address, price: 580n, quantity: 400, filled: 300 },
    { who: signer(14).address, price: 520n, quantity: 300, filled: 0 },
  ];
  const pvks = new Map<string, Point>([[s.me.address, s.myKeys.PVK]]);
  for (const b of bids) {
    if (!pvks.has(b.who)) {
      const k = await s.keys.create(b.who, s.tokenAddrF);
      s.token.registerAccount(b.who, k.Y, undefined, k.PVK);
      pvks.set(b.who, k.PVK);
    }
    s.auction.seedBid(fakeBidRecord({ bidder: b.who, requestedQuantity: b.quantity }));
    s.token.delegations.set(`${b.who}|${s.address}`, {
      allowanceCommitment: TOKEN_H, encryptedAllowance: 1n, escrowedDvk: { rX: 1n, cipher: 1n }, allowanceSalt: SIGMA_A, liveUntilLedger: CLOSE + FINALIZATION_GRACE_LEDGERS + 50_000,
    });
  }
  s.clock.advanceTo(CLOSE);
  await s.auction.closeMarket(seller);
  await s.auction.finalize(seller, bids.map((b) => b.filled), new Uint8Array());

  const recipients = [seller.address, FAKE_PLATFORM.feeWallet];
  for (const [i, b] of bids.entries()) {
    const a = settlementAmounts(b.price, b.quantity, b.filled).expose();
    let allowance: Secret<AllowanceState> = new Secret({ dvk: 77n + BigInt(i), vA: b.price * BigInt(b.quantity), rA: 0n, sigmaA: SIGMA_A });
    const data: Uint8Array[] = [];
    for (const [to, vTx] of [[recipients[0]!, a.seller], [recipients[1]!, a.fee], [b.who, a.refund]] as const) {
      const w = buildSpenderTransferWitness({ skOp: new Secret(5n), yOp: TOKEN_H, allowance, vTx, pvkRecipient: pvks.get(to) ?? (to === seller.address ? sellerKeys.PVK : fee.PVK), kAudR: TOKEN_H, kAudS: TOKEN_H }, rng);
      data.push(encodeSpenderTransferData(w, new Uint8Array(14_592)));
      allowance = w.next;
    }
    await s.auction.settle(seller, i, { sellerData: data[0]!, feeData: data[1]!, refundData: data[2]! }, new Uint8Array(14_592));
  }

  const account = new AccountApi(s.ctx);
  const sellerApi = new SellerApi({ signer: seller, factory: s.factory, auction: (x) => s.factory.auction(x), clock: s.clock, token: s.token, keys: s.keys, tokenAddress: s.ctx.tokenAddress });
  return { ...s, seller, sellerApi, account, bids };
}
