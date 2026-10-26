import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { anaWitness } from "../helpers/ana.js";

describe("prova bid_validity (RF-12)", () => {
  const artifacts = loadDevArtifacts();
  const prover = createProver({ artifacts });
  afterAll(() => prover.destroy());

  it("valid bid (Ana 650×200) executes and proves; the proof verifies with the VK of the contracts build", async () => {
    const w = anaWitness();
    const t = Date.now();
    const r = await prover.prove("bid_validity", w.inputs);
    const ms = Date.now() - t;

    expect(r.proof).toHaveLength(14_592);
    expect(await prover.verify("bid_validity", r)).toBe(true);
    expect(await prover.verificationKey("bid_validity")).toEqual(artifacts.vk("bid_validity"));

    expect(r.publicInputs.map((h) => h.replace(/^0x/, "").padStart(64, "0"))).toEqual(w.publicInputs.map((b) => Buffer.from(b).toString("hex")));
    console.info(`bid_validity: prova em ${ms} ms (Node)`);
  });
});
