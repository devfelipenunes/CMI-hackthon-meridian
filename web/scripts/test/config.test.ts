import { describe, expect, it } from "vitest";

import type { NetworkConfig } from "../../app/src/config/schema.js";
import { buildNetworkConfig } from "../lib/config.js";
import type { Deployment } from "../lib/deployment.js";

const FACTORY = `C${"A".repeat(55)}`;
const TOKEN = `C${"B".repeat(55)}`;
const UNDERLYING = `C${"C".repeat(55)}`;
const AUDITOR = `C${"D".repeat(55)}`;

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    network: "testnet",
    rpc_url: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    deployed_at_ledger: 100,
    contracts: {
      underlying: UNDERLYING,
      verifier: `C${"E".repeat(55)}`,
      auditor: AUDITOR,
      token: TOKEN,
      bid_verifier: `C${"F".repeat(55)}`,
      allocation_verifier: `C${"G".repeat(55)}`,
      settlement_verifier: `C${"H".repeat(55)}`,
      factory: FACTORY,
    },
    auction_wasm_hash: "a".repeat(64),
    auditor: { id: 0, key: "b".repeat(128) },
    fee_wallet: `G${"A".repeat(55)}`,
    finalization_grace_ledgers: 120,
    wasm_sha256: {},
    token_vks: {},
    pending: [],
    ...overrides,
  };
}

function existing(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    network: "testnet",
    rpcUrl: "https://old.example.org",
    horizonUrl: "https://horizon.example.org",
    friendbotUrl: "https://friendbot.example.org",
    passphrase: "old",
    deployedAtLedger: 1,
    finalizationGraceLedgers: 1,
    secondsPerLedger: 7,
    contracts: { factory: FACTORY, token: TOKEN, auditor: AUDITOR, underlying: UNDERLYING },
    auctionWasmHash: "c".repeat(64),
    registerData: "AQID",
    operatorKeyId: "d".repeat(64),
    envelopeKeyIsTestConstant: true,
    ...overrides,
  };
}

describe("buildNetworkConfig", () => {
  it("takes the deploy addresses, ledger and grace from the deployment", () => {
    const config = buildNetworkConfig(deployment(), null);
    expect(config.contracts).toEqual({ factory: FACTORY, token: TOKEN, auditor: AUDITOR, underlying: UNDERLYING });
    expect(config.deployedAtLedger).toBe(100);
    expect(config.finalizationGraceLedgers).toBe(120);
    expect(config.auctionWasmHash).toBe("a".repeat(64));
    expect(config.secondsPerLedger).toBe(5);
    expect(config.registerData).toBeNull();
  });

  it("keeps register_data while the token is the same", () => {
    const config = buildNetworkConfig(deployment(), existing());
    expect(config.registerData).toBe("AQID");
    expect(config.operatorKeyId).toBe("d".repeat(64));
    expect(config.secondsPerLedger).toBe(7);
  });

  it("drops register_data when the token changes (the proof binds the token)", () => {
    const other = `C${"Z".repeat(55)}`;
    const config = buildNetworkConfig(deployment(), existing({ contracts: { factory: FACTORY, token: other, auditor: AUDITOR, underlying: UNDERLYING } }));
    expect(config.registerData).toBeNull();
    expect(config.operatorKeyId).toBeNull();
  });
});
