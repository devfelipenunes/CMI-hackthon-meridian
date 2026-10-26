import { Keypair } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { addressToField, buildRegisterWitness, createProver, encodeRegisterData, generateTokenKeys, keypairSigner } from "@zolvency-cmi/core";
import { addTrustline, fundAccount, issueQuotaAsset, loadLocalDeployment, localChain, registerLocalAccount } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { InMemoryKeyProvider, MemoryOpeningStore, connectClient } from "../../src/index.js";

describe("sync na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("a fresh browser rebuilds the balance from the token events, after a lock and after a revoke", async () => {
    const dep = loadLocalDeployment();
    const chain = localChain(dep);
    const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
    const sellerKp = Keypair.random();
    const bidderKp = Keypair.random();
    await Promise.all([fundAccount(sellerKp.publicKey()), fundAccount(bidderKp.publicKey())]);
    await registerLocalAccount({ chain, dep, signer: keypairSigner(sellerKp.secret()), prover });
    const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: 1000 }] });
    await addTrustline(bidderKp, quota.asset);

    const opKeys = generateTokenKeys(addressToField(dep.contracts.token));
    const rw = buildRegisterWitness(opKeys);
    const registerData = encodeRegisterData(rw, (await prover.prove("register", rw.inputs)).proof);
    const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover });
    const { marketId } = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: (await chain.latestLedger()) + 300, eligibilityPolicy: null, feeReserve: 50_000_000n },
      { forNextMarket: async () => ({ marketId: 0n, address: "", registerData }) },
    );
    await seller.seller.openMarket(marketId);

    const keys = new InMemoryKeyProvider();
    const signer = keypairSigner(bidderKp.secret());
    const bidder = connectClient({ chain, contracts, signer, keys, prover, openings: new MemoryOpeningStore() });
    const freshBrowser = () => connectClient({ chain, contracts, signer, keys, prover, openings: new MemoryOpeningStore() });

    await bidder.account.ensureRegistered();
    await bidder.account.deposit(200_000n);
    await bidder.account.merge();
    await bidder.bidder.placeBid(await bidder.bidder.prepareBid(marketId, 650n, 200));
    await bidder.account.deposit(5_000n);

    const afterLock = freshBrowser();
    await expect(afterLock.account.balance()).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(await afterLock.account.sync()).toMatchObject({ source: "events" });
    expect(await afterLock.account.balance()).toEqual({ spendable: 70_000n, receiving: 5_000n });

    await bidder.bidder.recoverCollateral(marketId);
    const afterRevoke = freshBrowser();
    expect(await afterRevoke.account.sync()).toMatchObject({ source: "events" });
    expect(await afterRevoke.account.balance()).toEqual({ spendable: 200_000n, receiving: 5_000n });

    expect(await bidder.account.sync()).toMatchObject({ source: "stored", events: 0 });
  });
});
