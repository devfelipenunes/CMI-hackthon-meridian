import {
  BID_VALIDITY_PK_OPERATOR,
  Secret,
  encryptEnvelope,
  pedersenCommit,
  type BidEnvelope,
  type Point,
} from "@zolvency-cmi/core";

import { buildBidValidityWitness, type BidValidityParams } from "../../src/bidder/witness.js";

export const ANA = {
  price: 650n,
  quantity: 200,
  blinding: 111_222_333_444n,
  nullifierSeed: 999_888_777n,
  randomness: 424_242_424_242n,
  r: 123_456_789_012n,
  marketId: 42n,
  participantId: 7,
  minPrice: 500n,

  configHash: new Uint8Array("eb28541da7d5ebe9c61ac82e4202a1db61fb2bd1c48f11ab980a908ec7164d69".match(/../g)!.map((h) => parseInt(h, 16))),
};

export function anaEnvelope(price = ANA.price, pk: Point = BID_VALIDITY_PK_OPERATOR): BidEnvelope {
  return encryptEnvelope({ price, blinding: ANA.blinding, nullifierSeed: ANA.nullifierSeed }, pk, { field: () => 0n, scalar: () => ANA.r }).envelope;
}

export function anaParams(o: { price?: bigint; minPrice?: bigint; vA?: bigint; envelope?: BidEnvelope } = {}): BidValidityParams {
  const price = o.price ?? ANA.price;
  return {
    secrets: new Secret({ price, blinding: ANA.blinding, nullifierSeed: ANA.nullifierSeed }),
    marketId: ANA.marketId,
    participantId: ANA.participantId,
    requestedQuantity: ANA.quantity,
    minPricePerQuota: o.minPrice ?? ANA.minPrice,
    collateral: { cA: pedersenCommit(o.vA ?? price * BigInt(ANA.quantity), ANA.randomness), rA: new Secret(ANA.randomness) },
    envelope: o.envelope ?? anaEnvelope(price),
    r: new Secret(ANA.r),
    configHash: ANA.configHash,
  };
}

export const anaWitness = (o?: Parameters<typeof anaParams>[0]) => buildBidValidityWitness(anaParams(o));
