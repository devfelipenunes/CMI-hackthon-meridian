import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver } from "@zolvency-cmi/core";
import { AURORA } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { closedLocalMarket } from "../helpers/localnet.js";

describe("readBids na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("the Aurora bids are read and validated after close_market", { timeout: 900_000 }, async () => {
    const m = await closedLocalMarket(prover, AURORA.bids, { totalQuotas: AURORA.totalQuotas });
    const read = await m.operator.readBids(m.address);
    expect(read.map((b) => b.bidIndex)).toEqual([0, 1, 2, 3]);
    expect(read.map((b) => b.bidder)).toEqual(m.bidders.map((b) => b.kp.publicKey()));
    expect(read.map((b) => b.requestedQuantity)).toEqual(AURORA.bids.map((b) => b.quantity));
    expect(read.map((b) => b.secrets.expose().price)).toEqual(AURORA.bids.map((b) => b.price));
  });
});
