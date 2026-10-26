import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { QUOTA_UNIT, createProver } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { closedLocalMarket } from "../helpers/localnet.js";

describe("finalize na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("finalize accepted on localnet and unsold quotas return to seller", { timeout: 900_000 }, async () => {

    const m = await closedLocalMarket(prover, [{ price: 650n, quantity: 200 }, { price: 600n, quantity: 300 }], { totalQuotas: 1_000, closeIn: 200 });
    const plan = await m.operator.planAllocation(m.address);
    expect(plan.filled).toEqual([200, 300]);
    expect(plan.unsold).toBe(500);
    const { filled, proof } = await m.operator.proveAllocation(plan);
    await m.auction.finalize(m.submitter, filled, proof);

    expect(await m.auction.getState()).toBe("Finalized");
    expect(await m.auction.getAllocation()).toEqual([200, 300]);
    expect(await m.quotaBalance(m.sellerKp.publicKey())).toBe(500n * QUOTA_UNIT);
    expect(await m.quotaBalance(m.address)).toBe(500n * QUOTA_UNIT);
  });
});
