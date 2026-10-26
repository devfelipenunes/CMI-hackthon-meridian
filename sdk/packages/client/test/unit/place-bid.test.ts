import { pedersenCommit } from "@zolvency-cmi/core";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { AccountApi } from "../../src/index.js";
import { CLOSE, DEPOSIT, bidderScenario } from "../helpers/bidder.js";

describe("BidderApi.placeBid", () => {
  it("call order is set_spender then submit_bid", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    s.log.clear();
    expect(await s.bidder.placeBid(p)).toEqual({ bidIndex: 0 });
    expect(s.log.writes()).toEqual(["token.set_spender", "auction.submit_bid"]);

    const s2 = await bidderScenario();
    await s2.bidder.placeBid(await s2.bidder.prepareBid(s2.marketId, 650n, 200));
    expect(s2.log.all().filter((n) => n.startsWith("prove:") || s2.log.writes().includes(n))).toEqual([
      "auction.register_participant", "prove:bid_validity", "prove:set_spender", "token.set_spender", "auction.submit_bid",
    ]);
  });

  it("after the lock, the stored spendable opening opens the new on-chain commitment", async () => {
    const s = await bidderScenario();
    await s.bidder.placeBid(await s.bidder.prepareBid(s.marketId, 650n, 200));
    const o = (await s.openings.get(s.me.address, s.tokenAddrF))!.expose();
    expect(o.spendable.v).toBe(DEPOSIT - 130_000n);
    expect(pedersenCommit(o.spendable.v, o.spendable.r)).toEqual(s.token.accounts.get(s.me.address)!.spendableBalance);
  });

  it("checks on-chain C_a equals prepared C_a before submit_bid", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    const original = s.token.setSpender.bind(s.token);
    s.token.setSpender = async (signer, spender, live, data) => {
      const r = await original(signer, spender, live, data);
      s.token.delegations.get(`${signer.address}|${spender}`)!.allowanceCommitment = pedersenCommit(130_001n, 1n);
      return r;
    };
    s.log.clear();
    await expect(s.bidder.placeBid(p)).rejects.toMatchObject({ code: "CollateralMismatch", recovery: "revoke_spender" });
    expect(s.log.writes()).toEqual(["token.set_spender"]);
  });

  it("submit_bid rejected after lock returns recovery revoke_spender", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    s.clock.advanceTo(CLOSE);
    const err = await s.bidder.placeBid(p).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "Auction.BiddingClosed", recovery: "revoke_spender" });
    expect(await s.token.isSpender(s.me.address, s.address)).toBe(true);
    assertNoSecretLeak([130_000n, p.secrets.expose().bid.blinding, p.secrets.expose().rA], [err, s.logger]);
  });

  it("recoverCollateral revokes and isSpender becomes false", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    s.clock.advanceTo(CLOSE);
    await s.bidder.placeBid(p).catch(() => undefined);
    s.log.clear();

    await s.bidder.recoverCollateral(s.marketId);
    expect(s.log.writes()).toEqual(["token.revoke_spender"]);
    expect(s.log.all()).toContain("prove:revoke_spender");
    expect(await s.token.isSpender(s.me.address, s.address)).toBe(false);
    const o = (await s.openings.get(s.me.address, s.tokenAddrF))!.expose();
    expect(o.spendable.v).toBe(DEPOSIT);
    expect(pedersenCommit(o.spendable.v, o.spendable.r)).toEqual(s.token.accounts.get(s.me.address)!.spendableBalance);
  });

  it("recoverCollateral without a delegation is Token.DelegationNotFound, with no write", async () => {
    const s = await bidderScenario();
    await expect(s.bidder.recoverCollateral(s.marketId)).rejects.toMatchObject({ code: "Token.DelegationNotFound" });
    expect(s.log.writes()).toEqual([]);
  });

  it("resubmitting the same PreparedBid reuses the existing delegation", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    s.auction.failNext("submit_bid", "ResourceContention");
    await expect(s.bidder.placeBid(p)).rejects.toMatchObject({ code: "ResourceContention" });
    s.log.clear();
    expect(await s.bidder.placeBid(p)).toEqual({ bidIndex: 0 });
    expect(s.log.writes()).toEqual(["auction.submit_bid"]);
  });

  it("different price with active delegation explains revoke first", async () => {
    const s = await bidderScenario();
    const first = await s.bidder.prepareBid(s.marketId, 650n, 200);
    s.auction.failNext("submit_bid", "ResourceContention");
    await s.bidder.placeBid(first).catch(() => undefined);
    const other = await s.bidder.prepareBid(s.marketId, 700n, 100);
    s.log.clear();
    const err = await s.bidder.placeBid(other).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "Token.DelegationAlreadyExists", recovery: "revoke_spender" });
    expect((err as Error).message).toMatch(/revoke/i);
    expect(s.log.writes()).toEqual([]);
  });
});

describe("AccountApi (RF-08)", () => {
  async function fresh() {
    const s = await bidderScenario();
    s.token.accounts.delete(s.me.address);
    return { ...s, account: new AccountApi(s.ctx) };
  }

  it("ensureRegistered registers once and starts the openings at zero", async () => {
    const s = await fresh();
    const r = await s.account.ensureRegistered();
    expect(r.keys.Y).toEqual(s.myKeys.Y);
    expect(s.log.writes()).toEqual(["token.register"]);
    await s.account.ensureRegistered();
    expect(s.log.writes()).toEqual(["token.register"]);
    expect(await s.account.balance()).toEqual({ spendable: 0n, receiving: 0n });
  });

  it("deposit + merge keep the openings in step with the chain", async () => {
    const s = await fresh();
    await s.account.ensureRegistered();
    await s.account.deposit(200_000n);
    expect(await s.account.balance()).toEqual({ spendable: 0n, receiving: 200_000n });
    await s.account.merge();
    expect(await s.account.balance()).toEqual({ spendable: 200_000n, receiving: 0n });
  });

  it("warns DepositRevealsPrice when last deposit == price × qty", async () => {
    const s = await fresh();
    await s.account.ensureRegistered();
    await s.account.deposit(130_000n);
    await s.account.merge();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    expect(p.warnings).toEqual(["DepositRevealsPrice"]);
  });

  it("balance is BalanceOutOfSync when the chain moved without the SDK", async () => {
    const s = await fresh();
    await s.account.ensureRegistered();
    s.token.accounts.get(s.me.address)!.receivingBalance = pedersenCommit(5n, 0n);
    await expect(s.account.balance()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
  });
});
