import type { BidEnvelope } from "../../envelope/envelope.js";
import { hashLimbs, pointToBytes, toBytes32BE, u32Field, u64Field, type Point } from "../../field/encoding.js";
import type { Field } from "../../field/field.js";

export const BID_VALIDITY_PK_OPERATOR: Point = Object.freeze({
  x: 0x1ebe28a1fc051bb1f14169760ae2e47374bfed3406ab44b3125c8f4d7908368cn,
  y: 0x0e6a8b7e04813fac76d9776a7da692f6c5ee02dafdbffa94175606f8441d60c8n,
});

export const BID_VALIDITY_PUBLIC_INPUTS = [
  "commitment",
  "nullifier",
  "market_id",
  "participant_id",
  "requested_quantity",
  "min_price_per_quota",
  "collateral_binding_x",
  "collateral_binding_y",
  "r_point_x",
  "r_point_y",
  "ciphertext_price",
  "ciphertext_blinding",
  "ciphertext_seed",
  "config_hash_lo",
  "config_hash_hi",
] as const;

export interface BidValidityPublic {
  commitment: Field;
  nullifier: Field;
  marketId: bigint;
  participantId: number;
  requestedQuantity: number;
  minPricePerQuota: bigint;

  collateralBinding: Point;
  envelope: BidEnvelope;

  configHash: Uint8Array;
}

export function bidValidityPublicInputs(a: BidValidityPublic): Uint8Array[] {
  if (a.configHash.length !== 32) throw new RangeError("config_hash must be 32 bytes");
  const { lo, hi } = hashLimbs(a.configHash);
  const c = pointToBytes(a.collateralBinding);
  const r = pointToBytes(a.envelope.rPoint);
  return [
    toBytes32BE(a.commitment),
    toBytes32BE(a.nullifier),
    u64Field(a.marketId),
    u32Field(a.participantId),
    u32Field(a.requestedQuantity),
    u64Field(a.minPricePerQuota),
    c.slice(0, 32),
    c.slice(32),
    r.slice(0, 32),
    r.slice(32),
    toBytes32BE(a.envelope.ctPrice),
    toBytes32BE(a.envelope.ctBlinding),
    toBytes32BE(a.envelope.ctSeed),
    toBytes32BE(lo),
    toBytes32BE(hi),
  ];
}
