import { Keypair } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { addressToField, buildRegisterWitness, createProver, encodeRegisterData, generateTokenKeys, keypairSigner } from "@zolvency-cmi/core";
import { addTrustline, fundAccount, issueQuotaAsset, loadLocalDeployment, localChain, registerLocalAccount } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { InMemoryKeyProvider, connectClient } from "../../src/index.js";

describe("bid na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("bid accepted end to end on localnet", async () => {
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
    const { marketId, address } = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: (await chain.latestLedger()) + 300, eligibilityPolicy: null, feeReserve: 50_000_000n },
      { forNextMarket: async () => ({ marketId: 0n, address: "", registerData }) },
    );
    await seller.seller.openMarket(marketId);

    const bidder = connectClient({ chain, contracts, signer: keypairSigner(bidderKp.secret()), keys: new InMemoryKeyProvider(), prover });
    await bidder.account.ensureRegistered();
    await bidder.account.deposit(200_000n);
    await bidder.account.merge();
    expect(await bidder.account.balance()).toEqual({ spendable: 200_000n, receiving: 0n });

    const prepared = await bidder.bidder.prepareBid(marketId, 650n, 200);
    expect(prepared.auction).toBe(address);
    const { bidIndex } = await bidder.bidder.placeBid(prepared);

    expect(bidIndex).toBe(0);
    const record = await bidder.auctionAt(address).getBidRecord(0);
    expect(record.bidder).toBe(bidderKp.publicKey());
    expect(record.commitment).toBe(prepared.submission.commitment);
    expect(record.requestedQuantity).toBe(200);
    expect(await bidder.token.isSpender(bidderKp.publicKey(), address)).toBe(true);
    expect(await bidder.account.balance()).toEqual({ spendable: 70_000n, receiving: 0n });
  });
});
