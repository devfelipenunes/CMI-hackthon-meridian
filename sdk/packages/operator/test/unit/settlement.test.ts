import { CallLog, FakeProver, assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { buildSettlementLegs } from "../../src/index.js";
import { AURORA_BIDS, SK_ENV, SK_OP, SUBMITTER, TOKEN, cancelledMarket, finalizedMarket } from "../helpers/market.js";
import { Secret } from "@zolvency-cmi/core";

function proved(prover: FakeProver) {
  const legs = prover.proved.filter((p) => p.circuit === "spender_transfer").map((p) => BigInt(p.inputs.v_tx as string));
  const binding = prover.proved.filter((p) => p.circuit === "settlement_binding");
  return { legs, binding: binding.map((b) => b.inputs), order: prover.proved.map((p) => p.circuit) };
}

describe("CmiOperator.buildSettlement (passo 5.3)", () => {
  it("partial (Carla): seller, fee and refund legs in this order, then the binding", async () => {
    const prover = new FakeProver(new CallLog());
    const m = await finalizedMarket(AURORA_BIDS, { prover });
    prover.proved.length = 0;
    const p = await m.operator.buildSettlement(m.auction.address, 2);
    expect(p.bidIndex).toBe(2);
    const r = proved(prover);
    expect(r.order).toEqual(["spender_transfer", "spender_transfer", "spender_transfer", "settlement_binding"]);

    expect(r.legs).toEqual([156_600n, 17_400n, 58_000n]);
    expect(BigInt(r.binding[0]!.filled_quantity as string)).toBe(300n);
  });

  it("always builds 3 legs (D-08), even when filled = 0 (Diego)", async () => {
    const prover = new FakeProver(new CallLog());
    const m = await finalizedMarket(AURORA_BIDS, { prover });
    prover.proved.length = 0;
    const p = await m.operator.buildSettlement(m.auction.address, 3);
    expect(proved(prover).legs).toEqual([0n, 0n, 520n * 300n]);
    for (const data of [p.sellerData, p.feeData, p.refundData]) expect(data.length).toBeGreaterThan(14_592);
  });

  it("full (Ana): no refund", async () => {
    const prover = new FakeProver(new CallLog());
    const m = await finalizedMarket(AURORA_BIDS, { prover });
    prover.proved.length = 0;
    await m.operator.buildSettlement(m.auction.address, 0);

    expect(proved(prover).legs).toEqual([117_000n, 13_000n, 0n]);
  });

  it("cancelled market builds refund-only payload", async () => {
    const prover = new FakeProver(new CallLog());
    const m = await cancelledMarket(AURORA_BIDS, { prover });
    prover.proved.length = 0;
    const p = await m.operator.buildSettlement(m.auction.address, 2);
    const r = proved(prover);
    expect(r.legs).toEqual([0n, 0n, 580n * 400n]);
    expect(BigInt(r.binding[0]!.filled_quantity as string)).toBe(0n);
    expect(await m.auction.settle(SUBMITTER, 2, p, p.proof)).toBe("Settled");
    expect(await m.auction.getState()).toBe("Cancelled");
  });

  it("a bid without collateral delegation has no settlement (it goes to release_unsettled)", async () => {
    const m = await finalizedMarket(AURORA_BIDS.map((b, i) => (i === 1 ? { ...b, revoked: true } : b)));
    await expect(m.operator.buildSettlement(m.auction.address, 1)).rejects.toMatchObject({ code: "Token.DelegationNotFound" });
  });

  it("no secret in SettlementPayload JSON", async () => {
    const m = await finalizedMarket(AURORA_BIDS);
    const payloads = [];
    for (const i of [0, 2, 3]) payloads.push(await m.operator.buildSettlement(m.auction.address, i));
    const secrets = [
      SK_OP,
      ...m.secrets.flatMap((s) => [s.price, s.blinding, s.nullifierSeed]),
      156_600n, 17_400n, 58_000n, 117_000n, 13_000n, 156_000n,
    ];
    assertNoSecretLeak(secrets, [JSON.stringify(payloads.map((p) => ({ bidIndex: p.bidIndex }))), m.logger]);
    for (const p of payloads) expect(Object.keys(p).sort()).toEqual(["bidIndex", "feeData", "proof", "refundData", "sellerData"]);
  });

  it("buildSettlementLegs chains the 3 legs for the amounts it is given (the E2E builds the malicious ones)", async () => {
    const prover = new FakeProver(new CallLog());
    const m = await finalizedMarket(AURORA_BIDS, { prover });
    prover.proved.length = 0;

    const legs = await buildSettlementLegs({
      auction: m.auction, token: m.token, tokenAddress: TOKEN, spenderKey: new Secret(SK_OP), envelopeKey: new Secret(SK_ENV), prover, bidIndex: 1, logger: m.logger,
    }, { seller: 300_000n, fee: 0n, refund: 0n });
    expect(proved(prover).legs).toEqual([300_000n, 0n, 0n]);
    expect(proved(prover).binding).toHaveLength(0);
    expect(legs.sellerData.length).toBeGreaterThan(14_592);
  });
});
