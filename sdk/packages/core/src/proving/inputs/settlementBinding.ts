import { settlementAmounts } from "../../allocation/settlement.js";
import type { BidOpening } from "../../bid/bid.js";
import { pointToBytes, toBytes32BE, u32Field, type Point } from "../../field/encoding.js";
import { FR_MODULUS, type Field } from "../../field/field.js";
import type { Secret } from "../../secret.js";
import type { NoirInputs } from "../prover.js";

export const SETTLEMENT_BINDING_PUBLIC_INPUTS = [
  "bid_commitment",
  "requested_quantity",
  "filled_quantity",
  "fee_bps",
  "c_seller_x",
  "c_seller_y",
  "c_fee_x",
  "c_fee_y",
  "c_refund_x",
  "c_refund_y",
] as const;

export interface SettlementBindingPublic {
  commitment: Field;
  requested: number;

  filled: number;
  feeBps: number;

  cSeller: Point;
  cFee: Point;
  cRefund: Point;
}

export interface SettlementBindingParams extends SettlementBindingPublic {
  opening: Secret<BidOpening>;

  blindings: Secret<{ rSeller: Field; rFee: Field; rRefund: Field }>;

  fee?: Secret<bigint>;
}

export function settlementBindingPublicInputs(a: SettlementBindingPublic): Uint8Array[] {
  const point = (p: Point): Uint8Array[] => {
    const b = pointToBytes(p);
    return [b.slice(0, 32), b.slice(32)];
  };
  return [
    toBytes32BE(a.commitment),
    u32Field(a.requested),
    u32Field(a.filled),
    u32Field(a.feeBps),
    ...point(a.cSeller),
    ...point(a.cFee),
    ...point(a.cRefund),
  ];
}

const hex = (v: bigint): string => `0x${v.toString(16).padStart(64, "0")}`;
const bytesHex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

export function buildSettlementBindingWitness(p: SettlementBindingParams): { inputs: NoirInputs; publicInputs: Uint8Array[] } {
  const o = p.opening.expose();
  const amounts = settlementAmounts(o.price, p.requested, p.filled, BigInt(p.feeBps)).expose();
  const fee = p.fee?.expose() ?? amounts.fee;
  const feeRem = (((amounts.gross * BigInt(p.feeBps) - fee * 10_000n) % FR_MODULUS) + FR_MODULUS) % FR_MODULUS;
  const r = p.blindings.expose();
  const publicInputs = settlementBindingPublicInputs(p);
  const inputs: NoirInputs = Object.fromEntries(SETTLEMENT_BINDING_PUBLIC_INPUTS.map((name, i) => [name, bytesHex(publicInputs[i]!)]));
  Object.assign(inputs, {
    price: hex(o.price),
    market_id: hex(o.marketId),
    participant_id: hex(BigInt(o.participantId)),
    blinding: hex(o.blinding),
    nullifier_seed: hex(o.nullifierSeed),
    fee: hex(fee),
    fee_rem: hex(feeRem),
    r_seller: hex(r.rSeller),
    r_fee: hex(r.rFee),
    r_refund: hex(r.rRefund),
  });
  return { inputs, publicInputs };
}
