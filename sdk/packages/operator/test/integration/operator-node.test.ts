import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { Secret, createProver } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { runOperatorKeeper } from "../../../../examples/operator-node/src/operator.js";
import { InMemoryOperatorKeyStore } from "../../src/index.js";
import { closedLocalMarket } from "../helpers/localnet.js";

describe("exemplo operator-node na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("operator-node example runs keeper over localnet market", { timeout: 900_000 }, async () => {
    const m = await closedLocalMarket(prover, [{ price: 650n, quantity: 300 }, { price: 600n, quantity: 300 }], { totalQuotas: 500, closeIn: 200 });
    const keys = new InMemoryOperatorKeyStore({ spenderKey: new Secret(0x0a0c_7105_0005_0001n), envelopeKey: new Secret(987_654_321_098n), submitter: m.submitter });
    const r = await runOperatorKeeper({
      chain: m.chain,
      contracts: m.contracts,
      keys,
      prover,
      markets: [m.address],
      signal: AbortSignal.timeout(600_000),
      pollIntervalMs: 1_000,
    });
    expect(r).toEqual({ done: [m.address], skipped: [] });
    expect(await m.auction.getState()).toBe("Settled");
    expect(await m.auction.getAllocation()).toEqual([300, 200]);
  });
});
