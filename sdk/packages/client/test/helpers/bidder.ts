import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  Secret,
  TOKEN_H,
  addressToField,
  keypairSigner,
  pedersenCommit,
  scalarMul,
  type MarketParams,
  type Prover,
  type Signer,
} from "@zolvency-cmi/core";
import { CallLog, FakeClock, FakeFactory, FakeProver, FakeQuota, FakeToken, MemoryLogger, SeededRng } from "@zolvency-cmi/testing";

import { BidderApi, InMemoryKeyProvider, MemoryOpeningStore } from "../../src/index.js";

export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
export const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
export const NOW = 100;
export const CLOSE = 1_000;
export const DEPOSIT = 300_000n;
export const PARAMS: MarketParams = { quotaAsset: QUOTA, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: CLOSE, eligibilityPolicy: null, feeReserve: 50_000_000n };

const signer = (seed: number): Signer => keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)).secret());

export async function bidderScenario(o: { seed?: string; deposit?: bigint; trustline?: boolean; lastDeposit?: bigint; prover?: Prover } = {}) {
  const log = new CallLog();
  const clock = new FakeClock(NOW);
  const token = new FakeToken({ log, clock });
  const quota = new FakeQuota(log);
  const factory = new FakeFactory({ log, clock, token });
  const prover = new FakeProver(log);
  const logger = new MemoryLogger();
  const rng = new SeededRng(o.seed ?? "bid");
  const keys = new InMemoryKeyProvider({ rng: new SeededRng("keys") });
  const openings = new MemoryOpeningStore();
  const tokenAddrF = addressToField(TOKEN);

  const seller = signer(6);
  const { marketId, address } = await factory.createMarket(seller, PARAMS, new Uint8Array([1]));
  const auction = factory.auction(address);
  await auction.openMarket(seller);
  token.registerAccount(address, scalarMul(0x0a0c_7105n, TOKEN_H));

  const me = signer(1);
  const myKeys = await keys.create(me.address, tokenAddrF);
  const deposit = o.deposit ?? DEPOSIT;
  token.registerAccount(me.address, myKeys.Y, pedersenCommit(deposit, 0n));
  await openings.put(me.address, tokenAddrF, new Secret({ spendable: { v: deposit, r: 0n }, receiving: { v: 0n, r: 0n }, lastDeposit: o.lastDeposit ?? deposit }));
  if (o.trustline ?? true) quota.addTrustline(QUOTA, me.address);
  log.clear();

  const ctx = { signer: me, factory, auction: (a: string) => factory.auction(a), token, quota, clock, prover: o.prover ?? prover, keys, tokenAddress: TOKEN, openings, rng, logger };
  return { log, clock, token, quota, factory, prover, logger, keys, openings, tokenAddrF, me, myKeys, marketId, address, auction, ctx, bidder: new BidderApi(ctx), other: signer(2) };
}
