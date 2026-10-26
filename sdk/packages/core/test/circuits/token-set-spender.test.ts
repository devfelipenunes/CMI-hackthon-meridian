import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { buildSetSpenderWitness, createProver } from "../../src/index.js";
import { fixture } from "../helpers/token-fixture.js";

describe("set_spender witness", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });

  it("set_spender witness executes against circuit", async () => {
    const { params, rng } = fixture();
    await expect(prover.execute("set_spender", buildSetSpenderWitness(params, rng).inputs)).resolves.toBeUndefined();
  });

  it("a payload inconsistent with the inputs does not satisfy the circuit", async () => {
    const { params, rng } = fixture();
    const w = buildSetSpenderWitness(params, rng);
    await expect(prover.execute("set_spender", { ...w.inputs, v_a: "0x01" })).rejects.toMatchObject({ code: "ProofFailed" });
  });
});
