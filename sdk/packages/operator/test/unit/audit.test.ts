import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { AccountApi, BidderApi, InMemoryKeyProvider, MarketsApi, MemoryOpeningStore, SellerApi, type BidderContext, type MarketEvent } from "@zolvency-cmi/client";
import { FINALIZATION_GRACE_LEDGERS, Secret, addressToField, deriveTokenKeys, generateTokenKeys, keypairSigner, type Signer } from "@zolvency-cmi/core";
import { CallLog, FAKE_PLATFORM, FakeClock, FakeFactory, FakeProver, FakeQuota, FakeToken, MemoryLogger, SeededRng, assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { CmiOperator, InMemoryOperatorKeyStore, Keeper, type KeeperEvent } from "../../src/index.js";

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
const SK_OP = 0x0a0c_7105_00a0_d170n;
const SK_ENV = 987_654_321_098n;
const CLOSE = 1_000;
const BIDS = [
  { price: 650_017n, quantity: 200 },
  { price: 600_029n, quantity: 500 },
  { price: 580_031n, quantity: 400 },
  { price: 520_043n, quantity: 300 },
];
const signer = (seed: number): Signer => keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)).secret());

describe("auditoria de privacidade (passo 6.1)", () => {
  it("full aurora run leaks no secret to any sink", async () => {
    const log = new CallLog();
    const clock = new FakeClock(100);
    const token = new FakeToken({ log, clock });
    const quota = new FakeQuota(log);
    const factory = new FakeFactory({ log, clock, token });
    const prover = new FakeProver(log);
    const clientLogger = new MemoryLogger();
    const opLogger = new MemoryLogger();
    const keys = new InMemoryKeyProvider({ rng: new SeededRng("audit-keys") });
    const tokenAddrF = addressToField(TOKEN);
    const ctx = (s: Signer): BidderContext => ({
      signer: s, factory, auction: (a: string) => factory.auction(a), token, quota, clock, prover, keys, tokenAddress: TOKEN,
      openings: new MemoryOpeningStore(), rng: new SeededRng(`audit-${s.address}`), logger: clientLogger,
    });

    const seller = signer(6);
    const sellerCtx = ctx(seller);
    const sellerAccount = new AccountApi(sellerCtx);
    const sellerApi = new SellerApi(sellerCtx);
    await sellerAccount.ensureRegistered();
    const fee = generateTokenKeys(tokenAddrF, new SeededRng("fee"));
    token.registerAccount(FAKE_PLATFORM.feeWallet, fee.Y, undefined, fee.PVK);

    const operator = new CmiOperator({
      keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(SK_OP), envelopeKey: new Secret(SK_ENV), submitter: signer(5) }),
      factory, tokenAddress: TOKEN, prover, logger: opLogger, auction: (a) => factory.auction(a), token,
    });
    const { marketId, address } = await sellerApi.createMarket(
      { quotaAsset: QUOTA, totalQuotas: 1_000, minPricePerQuota: 500n, closeLedger: CLOSE, eligibilityPolicy: null, feeReserve: 50_000_000n },
      { forNextMarket: () => operator.registerDataForNextMarket() },
    );
    token.registerAccount(address, deriveTokenKeys(SK_OP, tokenAddrF).Y);
    await sellerApi.openMarket(marketId);

    const errors: unknown[] = [];
    const sinks: unknown[] = [];
    const secrets: bigint[] = [SK_OP, SK_ENV, fee.sk.expose(), fee.vk.expose()];
    const bidders: { account: AccountApi; bidder: BidderApi }[] = [];
    for (const [i, b] of BIDS.entries()) {
      const s = signer(20 + i);
      const c = ctx(s);
      const account = new AccountApi(c);
      const bidder = new BidderApi(c);
      const k = (await account.ensureRegistered()).keys;
      quota.addTrustline(QUOTA, s.address);
      await account.deposit(b.price * BigInt(b.quantity));
      await account.merge();

      errors.push(await bidder.prepareBid(marketId, 499n, 10).catch((e: unknown) => e));
      const p = await bidder.prepareBid(marketId, b.price, b.quantity);
      sinks.push(p);
      await bidder.placeBid(p);
      const bs = p.secrets.expose();
      secrets.push(b.price, b.price * BigInt(b.quantity), bs.bid.blinding, bs.bid.nullifierSeed, bs.rA, k.sk.expose(), k.vk.expose());
      bidders.push({ account, bidder });
    }
    const sellerKeys = (await keys.get(seller.address, tokenAddrF))!;
    secrets.push(sellerKeys.sk.expose(), sellerKeys.vk.expose());

    clock.advanceTo(CLOSE);
    const keeperEvents: KeeperEvent[] = [];
    const keeper = new Keeper(operator, { clock, onEvent: (e) => keeperEvents.push(e) });
    sinks.push(await operator.planAllocation(address).catch(() => null));
    for (let i = 0; i < 20; i++) {
      const a = await keeper.tick(address);
      if (a.kind === "done") break;
      clock.advanceBy(1);
    }
    expect(await factory.auction(address).getState()).toBe("Settled");

    secrets.push(BIDS[2]!.price * 300n, BIDS[2]!.price * 100n, (BIDS[0]!.price * 200n * 9n) / 10n);

    for (const b of bidders) {
      await b.account.receive(CLOSE);
      await b.account.merge();
      await b.bidder.status(marketId);
    }
    await sellerApi.proceeds(marketId);
    await sellerAccount.receive(CLOSE);
    await sellerAccount.merge();

    const markets = new MarketsApi(sellerCtx);
    const events: MarketEvent[] = [];
    for await (const e of markets.watch(marketId, { fromLedger: 0, pollIntervalMs: 0 })) events.push(e);
    sinks.push(await markets.get(marketId), await markets.list(), events);
    errors.push(await operator.buildSettlement(address, 0).catch((e: unknown) => e));

    expect(events.length).toBeGreaterThan(10);
    expect(keeperEvents.some((e) => e.kind === "settled")).toBe(true);
    assertNoSecretLeak(secrets, [clientLogger, opLogger, keeperEvents, errors, sinks.map((s) => JSON.stringify(s, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)))]);
    expect(clock.ledger()).resolves.toBeLessThan(CLOSE + FINALIZATION_GRACE_LEDGERS);
  });
});
