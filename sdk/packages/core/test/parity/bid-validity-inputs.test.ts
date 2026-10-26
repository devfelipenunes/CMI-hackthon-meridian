import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BID_VALIDITY_PK_OPERATOR,
  BID_VALIDITY_PUBLIC_INPUTS,
  GRUMPKIN_G,
  bidCommitment,
  bidNullifier,
  bidValidityPublicInputs,
  encryptEnvelope,
  pedersenCommit,
  scalarMul,
} from "../../src/index.js";

const CONTRACTS = fileURLToPath(new URL("../../../../contracts/", import.meta.url));

const ANA = {
  price: 650n,
  quantity: 200,
  blinding: 111_222_333_444n,
  nullifierSeed: 999_888_777n,
  randomness: 424_242_424_242n,
  r: 123_456_789_012n,
  marketId: 42n,
  participantId: 7,
  minPrice: 500n,
};

const PUBLIC_INPUTS_ORDER = [
  "commitment", "nullifier", "market_id", "participant_id", "requested_quantity",
  "min_price_per_quota", "collateral_binding_x", "collateral_binding_y",
  "r_point_x", "r_point_y", "ciphertext_price", "ciphertext_blinding",
  "ciphertext_seed", "config_hash_lo", "config_hash_hi",
];

describe("bid_validity: public inputs (RF-13)", () => {
  it("public inputs are the 15 fields in the frozen order", () => {
    expect(BID_VALIDITY_PUBLIC_INPUTS).toHaveLength(15);
    expect([...BID_VALIDITY_PUBLIC_INPUTS]).toEqual(PUBLIC_INPUTS_ORDER);
  });

  it("PK_operator is the circuit constant of the documented key (D-06)", () => {
    expect(BID_VALIDITY_PK_OPERATOR).toEqual(scalarMul(987_654_321_098n, GRUMPKIN_G));
    expect(BID_VALIDITY_PK_OPERATOR.x).toBe(0x1ebe28a1fc051bb1f14169760ae2e47374bfed3406ab44b3125c8f4d7908368cn);
  });

  it("public inputs built by SDK equal those the contract builds (fixture valid_ana)", () => {
    const ctx = JSON.parse(readFileSync(`${CONTRACTS}circuits/bid_validity/fixtures/valid_ana/context.json`, "utf8")) as { config_hash: string };
    const { envelope } = encryptEnvelope(
      { price: ANA.price, blinding: ANA.blinding, nullifierSeed: ANA.nullifierSeed },
      BID_VALIDITY_PK_OPERATOR,
      { field: () => 0n, scalar: () => ANA.r },
    );
    const fields = bidValidityPublicInputs({
      commitment: bidCommitment({ ...ANA, marketId: ANA.marketId, participantId: ANA.participantId }),
      nullifier: bidNullifier(ANA.nullifierSeed, ANA.marketId, ANA.participantId),
      marketId: ANA.marketId,
      participantId: ANA.participantId,
      requestedQuantity: ANA.quantity,
      minPricePerQuota: ANA.minPrice,
      collateralBinding: pedersenCommit(ANA.price * BigInt(ANA.quantity), ANA.randomness),
      envelope,
      configHash: Buffer.from(ctx.config_hash, "hex"),
    });

    const expected = readFileSync(`${CONTRACTS}artifacts/fixtures/bid_validity/valid_ana/public_inputs`);
    expect(fields).toHaveLength(15);
    expect(fields.every((f) => f.length === 32)).toBe(true);
    expect(Buffer.concat(fields).toString("hex")).toBe(expected.toString("hex"));
  });

  it("rejects a config_hash that is not 32 bytes", () => {
    expect(() =>
      bidValidityPublicInputs({
        commitment: 1n, nullifier: 2n, marketId: 1n, participantId: 0, requestedQuantity: 1, minPricePerQuota: 1n,
        collateralBinding: GRUMPKIN_G, envelope: { rPoint: GRUMPKIN_G, ctPrice: 1n, ctBlinding: 1n, ctSeed: 1n }, configHash: new Uint8Array(31),
      }),
    ).toThrow(RangeError);
  });
});
