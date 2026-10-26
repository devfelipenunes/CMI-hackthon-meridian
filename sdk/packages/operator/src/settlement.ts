import {
  CmiError,
  Secret,
  addressToField,
  buildSettlementBindingWitness,
  buildSpenderTransferWitness,
  deriveTokenKeys,
  encodeSpenderTransferData,
  recoverDelegation,
  settlementAmounts,
  type AccountId,
  type AllowanceState,
  type AuctionPort,
  type BidOpening,
  type SettlementLegs,
  type ContractId,
  type Field,
  type Logger,
  type Point,
  type Prover,
  type Scalar,
  type TokenPort,
} from "@zolvency-cmi/core";

import { openBid } from "./envelopes.js";

export interface SettlementPayload {
  bidIndex: number;
  sellerData: Uint8Array;
  feeData: Uint8Array;
  refundData: Uint8Array;

  proof: Uint8Array;
}

export interface BuildSettlementParams {
  auction: AuctionPort;
  token: TokenPort;
  tokenAddress: ContractId;
  spenderKey: Secret<Scalar>;
  envelopeKey: Secret<Scalar>;
  prover: Prover;
  bidIndex: number;
  logger: Logger;
}

export async function buildSettlement(p: BuildSettlementParams): Promise<SettlementPayload> {
  const c = await settlementContext(p);
  const amounts = settlementAmounts(c.price, c.record.requestedQuantity, c.filled, BigInt(c.market.feeBps)).expose();
  const [seller, fee, refund] = await chainLegs(p, c, amounts);

  const binding = buildSettlementBindingWitness({
    commitment: c.record.commitment,
    requested: c.record.requestedQuantity,
    filled: c.filled,
    feeBps: c.market.feeBps,
    cSeller: seller.cTx,
    cFee: fee.cTx,
    cRefund: refund.cTx,
    opening: c.opening,
    blindings: new Secret({ rSeller: seller.rTx, rFee: fee.rTx, rRefund: refund.rTx }),
  });
  const { proof } = await p.prover.prove("settlement_binding", binding.inputs);
  p.logger.info("settlement payload built", { auction: p.auction.address, bidIndex: p.bidIndex, filled: c.filled });
  return { bidIndex: p.bidIndex, sellerData: seller.data, feeData: fee.data, refundData: refund.data, proof };
}

export async function buildSettlementLegs(p: BuildSettlementParams, amounts: { seller: bigint; fee: bigint; refund: bigint }): Promise<SettlementLegs> {
  const [seller, fee, refund] = await chainLegs(p, await settlementContext(p), amounts);
  return { sellerData: seller.data, feeData: fee.data, refundData: refund.data };
}

interface SettlementContext {
  market: Awaited<ReturnType<AuctionPort["getMarket"]>>;
  record: Awaited<ReturnType<AuctionPort["getBidRecord"]>>;
  filled: number;
  price: bigint;
  opening: Secret<BidOpening>;
  keys: ReturnType<typeof deriveTokenKeys>;
  allowance: Secret<AllowanceState>;
}

async function settlementContext(p: BuildSettlementParams): Promise<SettlementContext> {
  const { auction, token, bidIndex } = p;
  const market = await auction.getMarket();
  const state = await auction.getState();
  if (state !== "Finalized" && state !== "Cancelled") throw new CmiError("Auction.InvalidState", "settle needs a Finalized or Cancelled market");
  const record = await auction.getBidRecord(bidIndex);
  const filled = state === "Cancelled" ? 0 : record.filledQuantity;
  const s = openBid(record, bidIndex, market.marketId, p.envelopeKey.expose()).expose();

  const keys = deriveTokenKeys(p.spenderKey.expose(), addressToField(p.tokenAddress));
  const d = await token.delegation(record.bidder, auction.address);
  if (d === null) throw new CmiError("Token.DelegationNotFound", `bid ${bidIndex}: no collateral delegation; the bid goes to release_unsettled`);
  const allowance = recoverDelegation(d, keys.sk, addressToField(auction.address));
  if (allowance.expose().vA !== s.price * BigInt(record.requestedQuantity)) {
    throw new CmiError("CollateralMismatch", `bid ${bidIndex}: the locked collateral is not price × requested_quantity`);
  }
  const opening = new Secret({ ...s, marketId: market.marketId, participantId: record.participantId });
  return { market, record, filled, price: s.price, opening, keys, allowance };
}

type Leg = { data: Uint8Array; cTx: Point; rTx: Field };

async function chainLegs(p: BuildSettlementParams, c: SettlementContext, amounts: { seller: bigint; fee: bigint; refund: bigint }): Promise<[Leg, Leg, Leg]> {
  const { token, prover } = p;
  const owner = await accountOf(token, c.record.bidder);
  const kAudS = await token.auditorKey(owner.auditorId);
  const legs: Leg[] = [];
  let state: Secret<AllowanceState> = c.allowance;
  for (const [to, vTx] of [
    [c.market.seller, amounts.seller],
    [c.market.platform.feeWallet, amounts.fee],
    [c.record.bidder, amounts.refund],
  ] as const) {
    const acc = await accountOf(token, to);
    const w = buildSpenderTransferWitness({
      skOp: c.keys.sk,
      yOp: c.keys.Y,
      allowance: state,
      vTx,
      pvkRecipient: acc.viewingPublicKey,
      kAudR: await token.auditorKey(acc.auditorId),
      kAudS,
    });
    const { proof } = await prover.prove("spender_transfer", w.inputs);
    const view = w.recipientView.expose();
    legs.push({ data: encodeSpenderTransferData(w, proof), cTx: view.cTx, rTx: view.rTx });
    state = w.next;
  }
  return legs as [Leg, Leg, Leg];
}

async function accountOf(token: TokenPort, who: AccountId | ContractId) {
  const acc = await token.account(who);
  if (acc === null) throw new CmiError("Token.AccountNotRegistered", "a settlement recipient has no confidential account");
  return acc;
}
