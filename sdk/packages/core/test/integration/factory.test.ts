import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, describe, expect, it } from "vitest";

import {
  addressToField,
  buildRegisterWitness,
  chainAuctionPort,
  chainFactoryPort,
  chainTokenPort,
  createProver,
  encodeRegisterData,
  generateTokenKeys,
  keypairSigner,
  specEntriesFromWasm,
} from "../../src/index.js";
import { FACTORY_SPEC, FACTORY_WASM_SHA256 } from "../../src/bindings/factory.js";
import { fundedKeypair, local } from "../helpers/localnet.js";

const FACTORY_WASM = fileURLToPath(new URL("../../../../contracts/target/wasm32v1-none/release/factory.wasm", import.meta.url));

describe("FactoryPort contra a Factory da rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("bindings are regenerated identically from pinned wasm (factory)", () => {
    const wasm = readFileSync(FACTORY_WASM);
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(FACTORY_WASM_SHA256);
    expect(specEntriesFromWasm(wasm)).toEqual([...FACTORY_SPEC]);
  });

  it("FactoryPort.predictMarketAddress equals deployed address", async () => {
    const l = local();
    const factory = chainFactoryPort({ chain: l.chain, address: l.factory });
    const seller = await fundedKeypair();

    const sw = buildRegisterWitness(generateTokenKeys(addressToField(l.token)));
    const sellerProof = (await prover.prove("register", sw.inputs)).proof;
    await chainTokenPort({ chain: l.chain, token: l.token, auditor: l.auditor }).register(keypairSigner(seller.secret()), (await factory.getPlatformConfig()).auditorId, encodeRegisterData(sw, sellerProof));

    const opKeys = generateTokenKeys(addressToField(l.token));
    const w = buildRegisterWitness(opKeys);
    const { proof } = await prover.prove("register", w.inputs);

    const id = await factory.nextMarketId();
    const predicted = await factory.predictMarketAddress(id);
    const ledger = await l.chain.latestLedger();
    const created = await factory.createMarket(
      keypairSigner(seller.secret()),
      { quotaAsset: l.xlm, totalQuotas: 10, minPricePerQuota: 500n, closeLedger: ledger + 1_000, eligibilityPolicy: null, feeReserve: 50_000_000n },
      encodeRegisterData(w, proof),
    );

    expect(created).toEqual({ marketId: id, address: predicted });
    expect(await factory.getMarketAddress(id)).toBe(predicted);
    expect(await factory.nextMarketId()).toBe(id + 1n);
    expect(await chainAuctionPort({ chain: l.chain, address: predicted }).getState()).toBe("Created");
    const auctionAcc = await chainTokenPort({ chain: l.chain, token: l.token, auditor: l.auditor }).account(predicted);
    expect(auctionAcc?.spendingKey).toEqual(opKeys.Y);
  });
});
