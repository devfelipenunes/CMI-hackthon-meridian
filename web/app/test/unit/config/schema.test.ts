import { describe, expect, it } from "vitest";

import { loadConfig, parseConfig } from "@/config/schema";

const valid = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  deployedAtLedger: 5_281_761,
  finalizationGraceLedgers: 120,
  secondsPerLedger: 5,
  contracts: {
    factory: "CCI7H273R7ECLXFMXHCNK4YI6Z6D6I66GTWPDU4JDL5HZZI35EMVJ32H",
    token: "CDD7G3P4RLDV3UPE4TH7N3HMR64OTJNUC7TTJVOT6L7IUHVSXQFVCVM6",
    auditor: "CCMU4OI2XPQWVNAW4WXR3HYKQTBB6QC2YSGYNMK6RJKD4MJI27VIRA7E",
    underlying: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  auctionWasmHash: "2215016a6de4ca0b053b8e466a06ae9235d065157be38d749bfe25d67871d4e4",
  registerData: null,
  operatorKeyId: null,
  envelopeKeyIsTestConstant: true,
};

describe("network config", () => {
  it("accepts the shipped testnet config", () => {
    const c = parseConfig(valid);
    expect(c.contracts.factory).toBe(valid.contracts.factory);
    expect(c.registerData).toBeNull();
  });

  it("rejects missing contracts, missing registerData key and bad addresses", () => {
    const { factory: _factory, ...noFactory } = valid.contracts;
    expect(() => parseConfig({ ...valid, contracts: noFactory })).toThrow();
    const { registerData: _r, ...noRegister } = valid;
    expect(() => parseConfig(noRegister)).toThrow();
    expect(() => parseConfig({ ...valid, contracts: { ...valid.contracts, token: "not-a-contract" } })).toThrow();
    expect(() => parseConfig({ ...valid, network: "mainnet" })).toThrow();
    expect(() => parseConfig({ ...valid, secondsPerLedger: 0 })).toThrow();
  });

  it("accepts an explicit registerData payload", () => {
    expect(parseConfig({ ...valid, registerData: "AQIDBA==" }).registerData).toBe("AQIDBA==");
  });

  it("loads and parses over HTTP with a typed failure", async () => {
    const ok = (async () => new Response(JSON.stringify(valid), { status: 200 })) as typeof fetch;
    await expect(loadConfig("/config/testnet.json", ok)).resolves.toMatchObject({ network: "testnet" });

    const missing = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    await expect(loadConfig("/config/testnet.json", missing)).rejects.toThrow(/configuration/i);

    const broken = (async () => new Response("{", { status: 200 })) as typeof fetch;
    await expect(loadConfig("/config/testnet.json", broken)).rejects.toThrow(/configuration/i);
  });
});
