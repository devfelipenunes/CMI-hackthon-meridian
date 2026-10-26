import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver } from "@zolvency-cmi/core";
import { AURORA } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { AURORA_BIDS, closedMarket } from "../helpers/market.js";

const hex = (b: Uint8Array): string => `0x${Buffer.from(b).toString("hex")}`;

describe("CmiOperator.planAllocation + proveAllocation (prova real)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("aurora plan proves and verifies locally", async () => {
    const { auction, operator } = await closedMarket(AURORA_BIDS, { prover });
    const plan = await operator.planAllocation(auction.address);
    expect(plan.filled).toEqual(AURORA.expected.filled);
    expect(plan.unsold).toBe(0);
    const { filled, proof } = await operator.proveAllocation(plan);
    expect(filled).toEqual(AURORA.expected.filled);
    expect(await prover.verify("winner_allocation", { proof, publicInputs: plan.publicInputs.map(hex) })).toBe(true);
  });

  it("undersubscription plan proves", async () => {
    const { auction, operator } = await closedMarket(AURORA_BIDS, { prover, totalQuotas: 5_000 });
    const plan = await operator.planAllocation(auction.address);
    expect(plan.filled).toEqual([200, 500, 400, 300]);
    expect(plan.unsold).toBe(3_600);
    const { proof } = await operator.proveAllocation(plan);
    expect(await prover.verify("winner_allocation", { proof, publicInputs: plan.publicInputs.map(hex) })).toBe(true);
  });
});
