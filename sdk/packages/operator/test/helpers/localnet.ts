import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { Prover } from "@zolvency-cmi/core";
import { InMemoryKeyProvider, MemoryOpeningStore, connectClient, type CmiClient } from "@zolvency-cmi/client";
import { Secret, chainAuctionPort, chainTokenPort, keypairSigner } from "@zolvency-cmi/core";
import { addTrustline, fundAccount, issueQuotaAsset, loadLocalDeployment, localChain } from "@zolvency-cmi/testing";

import { CmiOperator, InMemoryOperatorKeyStore } from "../../src/index.js";

export interface LocalBid {
  price: bigint;
  quantity: number;
}

export interface LocalBidder {
  kp: Keypair;
  client: CmiClient;
  openings: MemoryOpeningStore;
}

export async function closedLocalMarket(prover: Prover, bids: readonly LocalBid[], opts: { totalQuotas: number; minPricePerQuota?: bigint; closeIn?: number }) {
  const dep = loadLocalDeployment();
  const chain = localChain(dep);
  const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
  const sellerKp = Keypair.random();
  const submitterKp = Keypair.random();
  await Promise.all([fundAccount(sellerKp.publicKey()), fundAccount(submitterKp.publicKey())]);
  const sellerOpenings = new MemoryOpeningStore();
  const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover, openings: sellerOpenings });
  await seller.account.ensureRegistered();
  const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: opts.totalQuotas }] });

  const submitter = keypairSigner(submitterKp.secret());
  const operator = new CmiOperator({

    keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(0x0a0c_7105_0005_0001n), envelopeKey: new Secret(987_654_321_098n), submitter }),
    factory: seller.factory,
    tokenAddress: dep.contracts.token,
    prover,
    auction: (address) => chainAuctionPort({ chain, address }),
    token: chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor }),
  });
  const closeLedger = (await chain.latestLedger()) + (opts.closeIn ?? 300);
  const { marketId, address } = await seller.seller.createMarket(
    { quotaAsset: quota.sac, totalQuotas: opts.totalQuotas, minPricePerQuota: opts.minPricePerQuota ?? 500n, closeLedger, eligibilityPolicy: null, feeReserve: 50_000_000n },
    { forNextMarket: () => operator.registerDataForNextMarket() },
  );
  await seller.seller.openMarket(marketId);

  const bidders: LocalBidder[] = [];
  for (const b of bids) {
    const kp = Keypair.random();
    await fundAccount(kp.publicKey());
    await addTrustline(kp, quota.asset);
    const openings = new MemoryOpeningStore();
    const client = connectClient({ chain, contracts, signer: keypairSigner(kp.secret()), keys: new InMemoryKeyProvider(), prover, openings });
    await client.account.ensureRegistered();
    await client.account.deposit(b.price * BigInt(b.quantity));
    await client.account.merge();
    await client.bidder.placeBid(await client.bidder.prepareBid(marketId, b.price, b.quantity));
    bidders.push({ kp, client, openings });
  }

  while ((await chain.latestLedger()) < closeLedger) await new Promise((r) => setTimeout(r, 2_000));
  const auction = chainAuctionPort({ chain, address });
  await auction.closeMarket(submitter);

  const quotaBalance = async (who: string): Promise<bigint> =>
    BigInt(scValToNative(await chain.simulate(quota.sac, "balance", [nativeToScVal(who, { type: "address" })])) as bigint);
  return { dep, chain, contracts, marketId, address, closeLedger, auction, operator, submitter, sellerKp, seller, sellerOpenings, quota, quotaBalance, bidders };
}
