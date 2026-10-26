import { Networks, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { AUCTION_WASM_SHA256 } from "../../src/bindings/auction.js";
import { CONTRACTS_VERSIONS, ChainClient, contractsVersionOf, marketVersion } from "../../src/index.js";
import { FakeRpc } from "../helpers/rpc.js";

const AUCTION = StrKey.encodeContract(Buffer.alloc(32, 7));

function chainWith(hash: string) {
  const rpc = new FakeRpc();
  rpc.contractWasm.set(AUCTION, hash);
  return new ChainClient({ rpcUrl: "http://x", networkPassphrase: Networks.STANDALONE, server: rpc, pollIntervalMs: 0 });
}

describe("versão por mercado (S-18)", () => {
  it("market version is resolved from auction wasm hash", async () => {
    const v = await marketVersion(chainWith(AUCTION_WASM_SHA256), AUCTION);
    expect(v.auctionWasmSha256).toBe(AUCTION_WASM_SHA256);

    expect(v.releases).toEqual(["v0.1.0-rc.4", "v0.1.0"]);
    expect(contractsVersionOf(AUCTION_WASM_SHA256)).toBe(v);
  });

  it("unknown wasm hash throws UnsupportedContractsVersion", async () => {
    await expect(marketVersion(chainWith("ab".repeat(32)), AUCTION)).rejects.toMatchObject({ code: "UnsupportedContractsVersion" });
    expect(() => contractsVersionOf("cd".repeat(32))).toThrow(expect.objectContaining({ code: "UnsupportedContractsVersion" }));
  });

  it("every registered version is the hash of a pinned auction.wasm", () => {

    expect(CONTRACTS_VERSIONS.map((v) => v.auctionWasmSha256)).toEqual([AUCTION_WASM_SHA256]);
  });

  it("a contract with no instance on the network is not a market", async () => {
    const rpc = new FakeRpc();
    const chain = new ChainClient({ rpcUrl: "http://x", networkPassphrase: Networks.STANDALONE, server: rpc, pollIntervalMs: 0 });
    await expect(marketVersion(chain, AUCTION)).rejects.toMatchObject({ code: "TxFailed" });
  });
});
