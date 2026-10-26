import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, describe, expect, it } from "vitest";

import { buildWinnerAllocationWitness, createProver } from "../../src/index.js";
import { allocationParams } from "../helpers/allocation-vector.js";

describe("winner_allocation (execute)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("the contracts vector satisfies the circuit (poc4_8bids, partial fill at the margin)", async () => {
    await expect(prover.execute("winner_allocation", buildWinnerAllocationWitness(allocationParams("poc4_8bids")).inputs)).resolves.toBeUndefined();
  });

  it("wrong filled vector fails execute", async () => {
    const p = allocationParams("poc4_8bids");

    const wrong = { ...p, filled: [200, 150, 300, 250, 0, 300, 0, 0] };
    await expect(prover.execute("winner_allocation", buildWinnerAllocationWitness(wrong).inputs)).rejects.toThrow();
  });
});
