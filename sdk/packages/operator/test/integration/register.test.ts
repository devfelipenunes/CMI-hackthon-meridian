import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { Secret, addressToField, chainFactoryPort, chainTokenPort, createProver, deriveTokenKeys, keypairSigner } from "@zolvency-cmi/core";
import { fundAccount, loadLocalDeployment, localChain, registerLocalAccount } from "@zolvency-cmi/testing";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, describe, expect, it } from "vitest";

import { CmiOperator, InMemoryOperatorKeyStore } from "../../src/index.js";

describe("register_data do operador na rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("the operator register_data is accepted by the Auction constructor", async () => {
    const dep = loadLocalDeployment();
    const chain = localChain(dep);
    const factory = chainFactoryPort({ chain, address: dep.contracts.factory });
    const submitter = Keypair.random();
    const seller = Keypair.random();
    await Promise.all([fundAccount(submitter.publicKey()), fundAccount(seller.publicKey())]);

    await registerLocalAccount({ chain, dep, signer: keypairSigner(seller.secret()), prover });
    const skOp = 0x0a0c_7105_0002_1234_5678n;
    const operator = new CmiOperator({
      keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(skOp), envelopeKey: new Secret(987_654_321_098n), submitter: keypairSigner(submitter.secret()) }),
      factory,
      tokenAddress: dep.contracts.token,
      prover,
    });

    const next = await operator.registerDataForNextMarket();
    const created = await factory.createMarket(
      keypairSigner(seller.secret()),
      { quotaAsset: dep.contracts.underlying, totalQuotas: 10, minPricePerQuota: 500n, closeLedger: (await chain.latestLedger()) + 1_000, eligibilityPolicy: null, feeReserve: 50_000_000n },
      next.registerData,
    );

    expect(created).toEqual({ marketId: next.marketId, address: next.address });
    const acc = await chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor }).account(created.address);
    expect(acc?.spendingKey).toEqual(deriveTokenKeys(skOp, addressToField(dep.contracts.token)).Y);
  });
});
