import { describe, expect, it } from "vitest";

import { parseDeployment } from "../lib/deployment.js";

const CONTRACT = `C${"A".repeat(55)}`;
const ACCOUNT = `G${"A".repeat(55)}`;

function fixture(): Record<string, unknown> {
  return {
    network: "testnet",
    rpc_url: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    deployed_at_ledger: 100,
    contracts: {
      underlying: CONTRACT,
      verifier: CONTRACT,
      auditor: CONTRACT,
      token: CONTRACT,
      bid_verifier: CONTRACT,
      allocation_verifier: CONTRACT,
      settlement_verifier: CONTRACT,
      factory: CONTRACT,
    },
    auction_wasm_hash: "a".repeat(64),
    auditor: { id: 0, key: "b".repeat(128) },
    fee_wallet: ACCOUNT,
    finalization_grace_ledgers: 120,
    wasm_sha256: { auction: "a".repeat(64) },
    token_vks: { register: "c".repeat(64) },
    pending: [],
  };
}

describe("parseDeployment", () => {
  it("accepts the deploy JSON and normalizes hex", () => {
    const input = fixture();
    input.auction_wasm_hash = "A".repeat(64);
    const dep = parseDeployment(input);
    expect(dep.auction_wasm_hash).toBe("a".repeat(64));
    expect(dep.contracts.factory).toBe(CONTRACT);
    expect(dep.auditor.id).toBe(0);
  });

  it("rejects a deployment from another network", () => {
    const input = fixture();
    input.network = "mainnet";
    expect(() => parseDeployment(input)).toThrow(/testnet/);
  });

  it("rejects a hash that is not 64 lowercase hex", () => {
    const input = fixture();
    input.auction_wasm_hash = "zz";
    expect(() => parseDeployment(input)).toThrow(/sha256/);
  });

  it("rejects a fee wallet that is not a Stellar account", () => {
    const input = fixture();
    input.fee_wallet = CONTRACT;
    expect(() => parseDeployment(input)).toThrow(/fee_wallet/);
  });

  it("rejects a deployment without the contracts block", () => {
    const input = fixture();
    delete input.contracts;
    expect(() => parseDeployment(input)).toThrow(/contracts/);
  });
});
