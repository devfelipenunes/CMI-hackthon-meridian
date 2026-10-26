import { readFileSync } from "node:fs";

import { Secret, type SettlementBindingParams } from "../../src/index.js";
import { CONTRACTS } from "./allocation-vector.js";

interface SettlementCase {
  bid_commitment: string;
  requested_quantity: number;
  filled_quantity: number;
  fee_bps: number;
  c_seller: { x: string; y: string };
  c_fee: { x: string; y: string };
  c_refund: { x: string; y: string };
  price: number;
  market_id: number;
  participant_id: number;
  fee: string;
  fee_rem: string;
  blinding: string;
  nullifier_seed: string;
  r_seller: string;
  r_fee: string;
  r_refund: string;
}

export const SETTLEMENT_CASES = (JSON.parse(readFileSync(`${CONTRACTS}artifacts/parity-vectors/settlement.json`, "utf8")) as { cases: Record<string, SettlementCase> }).cases;

const point = (p: { x: string; y: string }) => ({ x: BigInt(p.x), y: BigInt(p.y) });

export function settlementParams(name: string): SettlementBindingParams {
  const c = SETTLEMENT_CASES[name]!;
  return {
    commitment: BigInt(c.bid_commitment),
    requested: c.requested_quantity,
    filled: c.filled_quantity,
    feeBps: c.fee_bps,
    cSeller: point(c.c_seller),
    cFee: point(c.c_fee),
    cRefund: point(c.c_refund),
    opening: new Secret({
      price: BigInt(c.price),
      marketId: BigInt(c.market_id),
      participantId: c.participant_id,
      blinding: BigInt(c.blinding),
      nullifierSeed: BigInt(c.nullifier_seed),
    }),
    blindings: new Secret({ rSeller: BigInt(c.r_seller), rFee: BigInt(c.r_fee), rRefund: BigInt(c.r_refund) }),
  };
}

export function settlementFixturePublicInputs(name: string): Buffer {
  return readFileSync(`${CONTRACTS}artifacts/fixtures/settlement_binding/${name}/public_inputs`);
}
