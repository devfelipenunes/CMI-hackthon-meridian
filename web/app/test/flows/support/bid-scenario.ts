import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { CmiClient, InMemoryKeyProvider, MemoryOpeningStore, type MarketView } from "@zolvency-cmi/client";
import {
  Secret,
  TOKEN_H,
  addressToField,
  pedersenCommit,
  scalarMul,
  type MarketParams,
  type Signer,
} from "@zolvency-cmi/core";
import { CallLog, FakeClock, FakeFactory, FakeProver, FakeQuota, FakeToken, SeededRng } from "@zolvency-cmi/testing";

import type { CmiResources } from "@/sdk/CmiProvider";

export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
export const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
export const NOW = 100;
export const CLOSE = 1_000;
export const DEPOSIT = 10_000_000_000n;
export const PARAMS: MarketParams = {
  quotaAsset: QUOTA,
  totalQuotas: 1_000,
  minPricePerQuota: 500n,
  closeLedger: CLOSE,
  eligibilityPolicy: null,
  feeReserve: 50_000_000n,
};

function fakeSigner(fill: number): Signer {
  return {
    address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill)),
    signTransaction: async (xdr: string) => xdr,
  };
}

export async function bidScenario(o: { deposit?: bigint; lastDeposit?: bigint; seed?: number } = {}) {
  const log = new CallLog();
  const clock = new FakeClock(NOW);
  const token = new FakeToken({ log, clock });
  const quota = new FakeQuota(log);
  const factory = new FakeFactory({ log, clock, token });
  const prover = new FakeProver(log);
  const keys = new InMemoryKeyProvider({ rng: new SeededRng("keys") });
  const openings = new MemoryOpeningStore();
  const tokenAddrF = addressToField(TOKEN);

  const seller = fakeSigner(1);
  const { marketId, address } = await factory.createMarket(seller, PARAMS, new Uint8Array([1]));
  const auction = factory.auction(address);
  await auction.openMarket(seller);
  token.registerAccount(address, scalarMul(0x0a0c_7105n, TOKEN_H));

  const me: Signer = fakeSigner(2);
  const myKeys = await keys.create(me.address, tokenAddrF);
  const deposit = o.deposit ?? DEPOSIT;
  token.registerAccount(me.address, myKeys.Y, pedersenCommit(deposit, 0n));
  await openings.put(
    me.address,
    tokenAddrF,
    new Secret({
      spendable: { v: deposit, r: 0n },
      receiving: { v: 0n, r: 0n },
      lastDeposit: o.lastDeposit ?? deposit,
    }),
  );
  quota.addTrustline(QUOTA, me.address);
  log.clear();

  const client = new CmiClient({
    signer: me,
    factory,
    auction: (next) => factory.auction(next),
    token,
    quota,
    clock,
    prover,
    keys,
    tokenAddress: TOKEN,
    openings,
  });

  return { log, clock, token, factory, prover, keys, openings, tokenAddrF, me, marketId, address, auction, client, deposit };
}

export function flowResources(s: Awaited<ReturnType<typeof bidScenario>>): CmiResources {
  return {
    client: s.client,
    signer: s.me,

    keys: s.keys as unknown as CmiResources["keys"],
    openings: s.openings as unknown as CmiResources["openings"],
    keyBackupStatus: async () => ({ backupRequired: false }),
  };
}

export function marketView(s: Awaited<ReturnType<typeof bidScenario>>): MarketView {
  return {
    marketId: s.marketId,
    address: s.address,
    seller: s.me.address,
    status: "Open",
    quotaAsset: QUOTA,
    totalQuotas: PARAMS.totalQuotas,
    minPricePerQuota: PARAMS.minPricePerQuota,
    closeLedger: PARAMS.closeLedger,
    finalizeByLedger: null,
    bidCount: 0,
    demand: 0,
    allocation: null,
  };
}
