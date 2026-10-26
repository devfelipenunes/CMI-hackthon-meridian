import { describe, expect, it } from "vitest";

import { SETTLEMENT_BINDING_PUBLIC_INPUTS, buildSettlementBindingWitness, settlementBindingPublicInputs } from "../../src/index.js";
import { SETTLEMENT_CASES, settlementFixturePublicInputs, settlementParams } from "../helpers/settlement-vector.js";

describe("settlement_binding: paridade com os contratos", () => {
  it.each(Object.keys(SETTLEMENT_CASES))("public inputs are the 10 fields in ADR-026 order (%s)", (name) => {
    const p = settlementParams(name);
    const pi = settlementBindingPublicInputs(p);
    expect(SETTLEMENT_BINDING_PUBLIC_INPUTS).toHaveLength(10);
    expect(pi).toHaveLength(10);
    expect(Buffer.concat(pi)).toEqual(settlementFixturePublicInputs(name));
    expect(buildSettlementBindingWitness(p).publicInputs).toEqual(pi);
  });

  it.each(Object.keys(SETTLEMENT_CASES))("the witness fee and fee_rem are the vector's (%s)", (name) => {
    const w = buildSettlementBindingWitness(settlementParams(name));
    expect(BigInt(w.inputs.fee as string)).toBe(BigInt(SETTLEMENT_CASES[name]!.fee));
    expect(BigInt(w.inputs.fee_rem as string)).toBe(BigInt(SETTLEMENT_CASES[name]!.fee_rem));
  });
});
