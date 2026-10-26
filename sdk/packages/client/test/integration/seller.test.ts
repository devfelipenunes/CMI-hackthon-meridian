import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import {
  QUOTA_UNIT,
  addressToField,
  buildRegisterWitness,
  chainAuctionPort,
  chainFactoryPort,
  createProver,
  encodeRegisterData,
  generateTokenKeys,
  keypairSigner,
} from "@zolvency-cmi/core";
import { fundAccount, issueQuotaAsset, loadLocalDeployment, localChain, registerLocalAccount } from "@zolvency-cmi/testing";
import { afterAll, describe, expect, it } from "vitest";

import { SellerApi, type RegisterDataProvider } from "../../src/index.js";

describe("seller na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("seller creates and opens a market; quotas move to escrow", async () => {
    const dep = loadLocalDeployment();
    const chain = localChain(dep);
    const factory = chainFactoryPort({ chain, address: dep.contracts.factory });
    const sellerKp = Keypair.random();
    await fundAccount(sellerKp.publicKey());

    await registerLocalAccount({ chain, dep, signer: keypairSigner(sellerKp.secret()), prover });
    const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: 1000 }] });

    const opKeys = generateTokenKeys(addressToField(dep.contracts.token));
    const w = buildRegisterWitness(opKeys);
    const registerData = encodeRegisterData(w, (await prover.prove("register", w.inputs)).proof);
    const provider: RegisterDataProvider = {
      async forNextMarket() {
        const marketId = await factory.nextMarketId();
        return { marketId, address: await factory.predictMarketAddress(marketId), registerData };
      },
    };

    const seller = new SellerApi({ signer: keypairSigner(sellerKp.secret()), factory, auction: (address) => chainAuctionPort({ chain, address }), clock: { ledger: () => chain.latestLedger() } });
    const balance = async (who: string) => BigInt(scValToNative(await chain.simulate(quota.sac, "balance", [nativeToScVal(who, { type: "address" })])) as bigint);

    const ledger = await chain.latestLedger();
    const { marketId, address } = await seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: ledger + 500, eligibilityPolicy: null, feeReserve: 50_000_000n },
      provider,
    );
    await seller.openMarket(marketId);

    const auction = chainAuctionPort({ chain, address });
    expect(await auction.getState()).toBe("Open");
    expect(await balance(address)).toBe(1000n * QUOTA_UNIT);
    expect(await balance(sellerKp.publicKey())).toBe(0n);
    expect(await auction.getConfigHash()).toHaveLength(32);
  });
});
