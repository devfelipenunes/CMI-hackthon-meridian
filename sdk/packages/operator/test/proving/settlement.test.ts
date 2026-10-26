import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { FEE_BPS, createProver, decodeSpenderTransferData, settlementBindingPublicInputs } from "@zolvency-cmi/core";
import { afterAll, describe, expect, it } from "vitest";

import { AURORA_BIDS, finalizedMarket } from "../helpers/market.js";

const hex = (b: Uint8Array): string => `0x${Buffer.from(b).toString("hex")}`;

describe("CmiOperator.buildSettlement (prova real)", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  async function verifies(i: number): Promise<boolean> {
    const m = await finalizedMarket(AURORA_BIDS, { prover });
    const p = await m.operator.buildSettlement(m.auction.address, i);
    const rec = await m.auction.getBidRecord(i);
    const [cSeller, cFee, cRefund] = [p.sellerData, p.feeData, p.refundData].map((d) => decodeSpenderTransferData(d).payload.cTx);
    const pi = settlementBindingPublicInputs({
      commitment: rec.commitment,
      requested: rec.requestedQuantity,
      filled: rec.filledQuantity,
      feeBps: Number(FEE_BPS),
      cSeller: cSeller!,
      cFee: cFee!,
      cRefund: cRefund!,
    });
    return prover.verify("settlement_binding", { proof: p.proof, publicInputs: pi.map(hex) });
  }

  it("c_tx decoded from the encoded legs equals the points proved", async () => {
    expect(await verifies(2)).toBe(true);
  });

  it.each([
    ["full (Ana)", 0],
    ["partial (Carla)", 2],
    ["zero (Diego)", 3],
  ])("%s builds and verifies", async (_name, i) => {
    expect(await verifies(i)).toBe(true);
  });
});
