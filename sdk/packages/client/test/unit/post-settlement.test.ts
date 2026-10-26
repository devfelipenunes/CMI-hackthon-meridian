import { pedersenCommit } from "@zolvency-cmi/core";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { CLOSE, DEPOSIT } from "../helpers/bidder.js";
import { settledAurora } from "../helpers/settled.js";

describe("pós-settlement (passo 5.6)", () => {
  it("bidder.status shows filled and refund for Carla", async () => {
    const s = await settledAurora();
    expect(await s.bidder.status(s.marketId)).toEqual({ bidIndex: 2, status: "Settled", requested: 400, filled: 300, refund: 58_000n });
  });

  it("merge moves refund to spendable", async () => {
    const s = await settledAurora();
    await expect(s.account.merge()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await s.account.receive(CLOSE)).toEqual({ transfers: 1 });
    await s.account.merge();
    expect(await s.account.balance()).toEqual({ spendable: DEPOSIT + 58_000n, receiving: 0n });
    expect(await s.account.receive(CLOSE)).toEqual({ transfers: 0 });
  });

  it("receive refuses openings that do not match the on-chain receiving balance", async () => {
    const s = await settledAurora();
    const acc = s.token.accounts.get(s.me.address)!;
    acc.receivingBalance = pedersenCommit(1n, 1n);
    await expect(s.account.receive(CLOSE)).rejects.toMatchObject({ code: "BalanceOutOfSync" });
  });

  it("seller.proceeds decrypts each winning payment (Ana 117.000 = 90% de 130.000)", async () => {
    const s = await settledAurora();
    expect(await s.sellerApi.proceeds(s.marketId)).toEqual([
      { bidIndex: 0, filled: 200, received: 117_000n },
      { bidIndex: 1, filled: 500, received: 270_000n },
      { bidIndex: 2, filled: 300, received: 156_600n },
    ]);
  });

  it("seller.proceeds has no entry for losers", async () => {
    const s = await settledAurora();
    expect((await s.sellerApi.proceeds(s.marketId)).some((p) => p.bidIndex === 3)).toBe(false);
  });

  it("seller.proceeds reports a settled winner whose leg is outside the RPC window with received null (S-23)", async () => {
    const s = await settledAurora();
    s.token.oldestEventLedger = CLOSE + 1;
    expect(await s.sellerApi.proceeds(s.marketId)).toEqual([
      { bidIndex: 0, filled: 200, received: null },
      { bidIndex: 1, filled: 500, received: null },
      { bidIndex: 2, filled: 300, received: null },
    ]);
  });

  it("bidder.status keeps refund null, without failing, when the leg is outside the RPC window (S-23)", async () => {
    const s = await settledAurora();
    s.token.oldestEventLedger = CLOSE + 1;
    expect(await s.bidder.status(s.marketId)).toEqual({ bidIndex: 2, status: "Settled", requested: 400, filled: 300, refund: null });
  });

  it("no secret of the receiving side in logs", async () => {
    const s = await settledAurora();
    await s.account.receive(CLOSE);
    await s.bidder.status(s.marketId);
    assertNoSecretLeak([s.myKeys.vk.expose(), s.myKeys.sk.expose()], [s.logger]);
  });
});
