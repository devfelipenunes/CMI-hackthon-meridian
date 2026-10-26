import { AURORA, assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { AURORA_BIDS as aurora, SK_ENV, SK_OP, closedMarket as scenario } from "../helpers/market.js";

describe("CmiOperator.readBids (passo 5.1: RF-16, RF-17, S-11)", () => {
  it("readBids decrypts every accepted bid in bid_index order", async () => {
    const { auction, operator, secrets, bidders } = await scenario(aurora);
    const read = await operator.readBids(auction.address);
    expect(read.map((b) => b.bidIndex)).toEqual([0, 1, 2, 3]);
    expect(read.map((b) => b.bidder)).toEqual(bidders);
    expect(read.map((b) => b.participantId)).toEqual([0, 1, 2, 3]);
    expect(read.map((b) => b.requestedQuantity)).toEqual(AURORA.bids.map((b) => b.quantity));
    expect(read.map((b) => b.secrets.expose())).toEqual(secrets);
  });

  it("throws OpeningMismatch when envelope does not reproduce commitment", async () => {
    const { auction, operator } = await scenario(aurora.map((b, i) => (i === 2 ? { ...b, tamper: true } : b)));
    await expect(operator.readBids(auction.address)).rejects.toMatchObject({ code: "OpeningMismatch" });
  });

  it("throws CollateralMismatch when recovered vA != price × requested", async () => {
    const { auction, operator } = await scenario(aurora.map((b, i) => (i === 1 ? { ...b, vA: b.price * BigInt(b.quantity) - 1n } : b)));
    await expect(operator.readBids(auction.address)).rejects.toMatchObject({ code: "CollateralMismatch" });
  });

  it("throws RootMismatch when local root != on-chain root", async () => {
    const { auction, operator } = await scenario(aurora, { commitmentsRoot: 123_456_789n });
    await expect(operator.readBids(auction.address)).rejects.toMatchObject({ code: "RootMismatch" });
  });

  it("never skips a bid (8 bids → 8 openings)", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ price: 500n + 10n * BigInt(i), quantity: 100 + i }));
    const { auction, operator } = await scenario(eight);
    const read = await operator.readBids(auction.address);
    expect(read.map((b) => b.bidIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(read.map((b) => b.secrets.expose().price)).toEqual(eight.map((b) => b.price));
  });

  it("a bid whose delegation was revoked is still read (release_unsettled decides it later)", async () => {
    const { auction, operator } = await scenario(aurora.map((b, i) => (i === 3 ? { ...b, revoked: true } : b)));
    const read = await operator.readBids(auction.address);
    expect(read.map((b) => b.bidIndex)).toEqual([0, 1, 2, 3]);
  });

  it("no secret in logs or errors", async () => {
    const ok = await scenario(aurora);
    const read = await ok.operator.readBids(ok.auction.address);
    const opening = await scenario(aurora.map((b, i) => (i === 0 ? { ...b, tamper: true } : b)));
    const openingErr = await opening.operator.readBids(opening.auction.address).catch((e: unknown) => e);
    const collateral = await scenario(aurora.map((b, i) => (i === 0 ? { ...b, vA: b.price * BigInt(b.quantity) - 1n } : b)));
    const collateralErr = await collateral.operator.readBids(collateral.auction.address).catch((e: unknown) => e);

    const secrets = [
      SK_OP,
      SK_ENV,
      ...ok.secrets.flatMap((s) => [s.price, s.blinding, s.nullifierSeed]),
      ...AURORA.bids.map((b) => b.price * BigInt(b.quantity)),
    ];
    assertNoSecretLeak(secrets, [ok.logger, opening.logger, collateral.logger, openingErr, collateralErr, JSON.stringify(read)]);
  });
});
