import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { GRUMPKIN_G, createProver, pedersenCommit, scalarMul, type NoirInputs } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { ANA, anaEnvelope, anaWitness } from "../helpers/ana.js";

const FIXTURE = fileURLToPath(new URL("../../../../contracts/artifacts/fixtures/bid_validity/valid_ana/public_inputs", import.meta.url));
const hex = (v: bigint): string => `0x${v.toString(16)}`;

describe("bid_validity witness (RF-12)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());
  const fails = (inputs: NoirInputs) => expect(prover.execute("bid_validity", inputs)).rejects.toMatchObject({ code: "ProofFailed" });

  it("valid bid (Ana 650×200) executes", async () => {
    await expect(prover.execute("bid_validity", anaWitness().inputs)).resolves.toBeUndefined();
  });

  it("the witness public inputs are the contract fixture", () => {
    const w = anaWitness();

    const expected = readFileSync(FIXTURE);
    expect(Buffer.concat(w.publicInputs.slice(0, 13)).toString("hex")).toBe(expected.subarray(0, 13 * 32).toString("hex"));
  });

  it("price == min_price executes", async () => {
    await expect(prover.execute("bid_validity", anaWitness({ minPrice: ANA.price }).inputs)).resolves.toBeUndefined();
  });

  it("price < min fails", async () => {
    await fails(anaWitness({ price: 400n, minPrice: 500n }).inputs);
  });

  it("price == 0 fails", async () => {
    await fails({ ...anaWitness().inputs, price: "0x0" });
  });

  it("price ≥ 2^63 fails", async () => {
    await fails({ ...anaWitness().inputs, price: hex(1n << 63n) });
  });

  it("C_a of price×qty+1 fails", async () => {
    await fails(anaWitness({ vA: ANA.price * BigInt(ANA.quantity) + 1n }).inputs);
  });

  it("C_a with other randomness fails", async () => {
    const other = pedersenCommit(ANA.price * BigInt(ANA.quantity), ANA.randomness + 1n);
    await fails({ ...anaWitness().inputs, collateral_binding_x: hex(other.x), collateral_binding_y: hex(other.y) });
  });

  it("envelope for another key fails", async () => {
    await fails(anaWitness({ envelope: anaEnvelope(ANA.price, scalarMul(ANA.r, GRUMPKIN_G)) }).inputs);
  });

  it("tampered ct_price fails", async () => {
    const w = anaWitness();
    await fails({ ...w.inputs, ciphertext_price: hex(BigInt(w.inputs.ciphertext_price as string) + 1n) });
  });

  it("commitment of other market_id fails", async () => {
    await fails({ ...anaWitness().inputs, market_id: hex(ANA.marketId + 1n) });
  });

  it("config_hash limbs: hi = the first 16 bytes, lo = the last 16 (CRYPTO.md)", () => {
    const w = anaWitness();
    const h = Buffer.from(ANA.configHash).toString("hex");
    expect(w.inputs.config_hash_hi).toBe(`0x${"0".repeat(32)}${h.slice(0, 32)}`);
    expect(w.inputs.config_hash_lo).toBe(`0x${"0".repeat(32)}${h.slice(32)}`);
  });
});
