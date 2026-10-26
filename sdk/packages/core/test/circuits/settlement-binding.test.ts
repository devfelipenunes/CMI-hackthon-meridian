import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, describe, expect, it } from "vitest";

import { Secret, buildSettlementBindingWitness, createProver } from "../../src/index.js";
import { SETTLEMENT_CASES, settlementParams } from "../helpers/settlement-vector.js";

describe("settlement_binding (execute)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it.each(Object.keys(SETTLEMENT_CASES))("the contracts vector satisfies the circuit (%s)", async (name) => {
    await expect(prover.execute("settlement_binding", buildSettlementBindingWitness(settlementParams(name)).inputs)).resolves.toBeUndefined();
  });

  it("a 20% fee fails execute", async () => {

    const p = { ...settlementParams("partial"), fee: new Secret(15_600n) };
    await expect(prover.execute("settlement_binding", buildSettlementBindingWitness(p).inputs)).rejects.toThrow();
  });
});
