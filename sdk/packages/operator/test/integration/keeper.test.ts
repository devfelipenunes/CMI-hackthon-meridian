import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { QUOTA_UNIT, createProver } from "@zolvency-cmi/core";
import { AURORA } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { Keeper, type KeeperAction } from "../../src/index.js";
import { closedLocalMarket } from "../helpers/localnet.js";

describe("Keeper na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  let m: Awaited<ReturnType<typeof closedLocalMarket>>;

  it("the keeper takes the Aurora market from Closed to Settled", { timeout: 1_200_000 }, async () => {
    m = await closedLocalMarket(prover, AURORA.bids, { totalQuotas: AURORA.totalQuotas });
    const keeper = new Keeper(m.operator, { clock: { ledger: () => m.chain.latestLedger() } });
    const actions: KeeperAction["kind"][] = [];
    for (let i = 0; i < 40; i++) {
      const a = await keeper.tick(m.address);
      actions.push(a.kind);
      if (a.kind === "done") break;
      if (a.kind === "wait") await new Promise((r) => setTimeout(r, 1_500));
    }
    expect(actions.filter((k) => k === "finalize")).toHaveLength(1);
    expect(actions.filter((k) => k === "settle")).toHaveLength(4);
    expect(await m.auction.getState()).toBe("Settled");
    for (let i = 0; i < 4; i++) expect(await m.auction.getSettlementStatus(i)).toBe("Settled");

    for (const [i, b] of m.bidders.entries()) expect(await m.quotaBalance(b.kp.publicKey())).toBe(BigInt(AURORA.expected.filled[i]!) * QUOTA_UNIT);
  });

  it("bidder and seller see the Aurora numbers and use them (5.6)", { timeout: 300_000 }, async () => {
    const carla = m.bidders[2]!.client;
    expect(await carla.bidder.status(m.marketId)).toEqual({ bidIndex: 2, status: "Settled", requested: 400, filled: 300, refund: 58_000n });
    expect(await carla.account.receive(m.closeLedger)).toEqual({ transfers: 1 });
    await carla.account.merge();
    expect(await carla.account.balance()).toEqual({ spendable: 58_000n, receiving: 0n });

    expect(await m.seller.seller.proceeds(m.marketId)).toEqual([
      { bidIndex: 0, filled: 200, received: AURORA.expected.ana.seller },
      { bidIndex: 1, filled: 500, received: 270_000n },
      { bidIndex: 2, filled: 300, received: 156_600n },
    ]);

    expect(await m.seller.account.receive(m.closeLedger)).toEqual({ transfers: 4 });
    await m.seller.account.merge();
    expect(await m.seller.account.balance()).toEqual({ spendable: 543_600n, receiving: 0n });
  });
});
