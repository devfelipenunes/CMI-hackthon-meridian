import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { bidderScenario } from "../helpers/bidder.js";

describe("prepareBid com provas reais", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("prepareBid builds a complete PreparedBid whose bid_validity proof verifies", async () => {
    const s = await bidderScenario({ prover });
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);

    expect(p.submission.proof).toHaveLength(14_592);
    expect(p.setSpender.data.length).toBeGreaterThan(14_592);
    expect(p.warnings).toEqual([]);
    expect(p.publicInputs).toHaveLength(15);
    expect(await prover.verify("bid_validity", { proof: p.submission.proof, publicInputs: p.publicInputs.map((b) => `0x${Buffer.from(b).toString("hex")}`) })).toBe(true);
  });
});
