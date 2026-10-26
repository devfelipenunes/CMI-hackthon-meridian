import { AURORA, assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { AURORA_BIDS, closedMarket } from "../helpers/market.js";

describe("CmiOperator.planAllocation (passo 5.2)", () => {
  it("the plan is the RF-17 rule over the validated bids, with the 23 public inputs", async () => {
    const { auction, operator } = await closedMarket(AURORA_BIDS);
    const plan = await operator.planAllocation(auction.address);
    expect(plan.auction).toBe(auction.address);
    expect(plan.filled).toEqual(AURORA.expected.filled);
    expect(plan.publicInputs).toHaveLength(23);
  });

  it("the plan refuses a market whose bids do not open (no plan from an invalid opening)", async () => {
    const { auction, operator } = await closedMarket(AURORA_BIDS.map((b, i) => (i === 0 ? { ...b, tamper: true } : b)));
    await expect(operator.planAllocation(auction.address)).rejects.toMatchObject({ code: "OpeningMismatch" });
  });

  it("no secret in the plan JSON or the logs", async () => {
    const { auction, operator, logger, secrets } = await closedMarket(AURORA_BIDS);

    const plan = await operator.planAllocation(auction.address);
    assertNoSecretLeak(secrets.flatMap((s) => [s.price, s.blinding, s.nullifierSeed]), [JSON.stringify({ ...plan, publicInputs: undefined }), logger]);
  });
});
