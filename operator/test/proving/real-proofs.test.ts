import type { NoirInputs, ProofResult, Prover } from "@zolvency-cmi/core";
import { AURORA } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { connectProver } from "../../src/chain/connect.js";
import { AURORA_BIDS, World } from "../helpers/world.js";
import { runUntil, testConfig, testService } from "../helpers/service.js";

type CircuitName = Parameters<Prover["prove"]>[0];

describe("provas reais pelo caminho do serviço", () => {
  const real = connectProver(testConfig());
  afterAll(() => real.destroy());

  it("Aurora: the winner_allocation and every settlement proof verify", async () => {
    const proofs: { circuit: CircuitName; result: ProofResult }[] = [];
    const recording: Prover = {
      execute: (c, i: NoirInputs) => real.execute(c, i),
      async prove(c, i) {
        const result = await real.prove(c, i);
        proofs.push({ circuit: c, result });
        return result;
      },
      verify: (c, r) => real.verify(c, r),
      verificationKey: (c) => real.verificationKey(c),
      destroy: async () => undefined,
    };
    const world = new World();
    Object.defineProperty(world, "prover", { value: recording });
    const s = await testService({ world });
    const { auction } = await world.market(AURORA_BIDS, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Settled");
    expect(await auction.getAllocation()).toEqual([...AURORA.expected.filled]);

    const byCircuit = (c: string) => proofs.filter((p) => p.circuit === c).length;
    expect(byCircuit("winner_allocation")).toBe(1);
    expect(byCircuit("settlement_binding")).toBe(4);
    expect(byCircuit("spender_transfer")).toBe(12);
    for (const p of proofs) {
      expect(p.result.proof.length).toBe(14_592);
      expect(await real.verify(p.circuit, p.result)).toBe(true);
    }
    await s.close();
  }, 600_000);
});
