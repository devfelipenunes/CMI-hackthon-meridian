import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, describe, expect, it } from "vitest";

import { Secret, bidCommitment, buildWinnerAllocationWitness, commitmentsRoot, createProver } from "../../src/index.js";
import { allocationParams } from "../helpers/allocation-vector.js";

describe("winner_allocation (prove)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("gap clearing price proves", async () => {

    const base = allocationParams("poc4_8bids");
    const bids = [
      { price: 650n, requestedQuantity: 200 },
      { price: 600n, requestedQuantity: 500 },
      { price: 580n, requestedQuantity: 400 },
      { price: 520n, requestedQuantity: 300 },
    ].map((b, i) => ({ ...b, blinding: 1_000n + BigInt(i), nullifierSeed: 2_000n + BigInt(i), participantId: i }));
    const root = commitmentsRoot(bids.map((b) => bidCommitment({ ...b, marketId: base.marketId })));
    const w = buildWinnerAllocationWitness({
      ...base,
      commitmentsRoot: root,
      totalSupply: 700,
      filled: [200, 500, 0, 0],
      clearingPrice: new Secret(590n),
      bids: new Secret(bids),
    });
    const proof = await prover.prove("winner_allocation", w.inputs);
    expect(await prover.verify("winner_allocation", proof)).toBe(true);
  });
});
