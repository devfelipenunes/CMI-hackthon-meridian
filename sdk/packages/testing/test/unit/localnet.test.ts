import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { StrKey } from "@stellar/stellar-sdk";
import { TOKEN_H, pointFromBytes, scalarMul } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { LOCALNET, PINNED_WASM_SHA256, TOKEN_VK_CIRCUITS, auditorKeyHex, parseDeployment } from "../../src/index.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = (n: number): string => StrKey.encodeContract(Buffer.alloc(32, n));

function deployJson(): Record<string, unknown> {
  return {
    network: "quickstart",
    rpc_url: "http://localhost:8000/soroban/rpc",
    passphrase: "Standalone Network ; February 2017",
    identity: "cmi-local-admin",
    admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    deployed_at_ledger: 42,
    contracts: {
      underlying: contract(1), verifier: contract(2), auditor: contract(3), token: contract(4),
      bid_verifier: contract(5), allocation_verifier: contract(6), settlement_verifier: contract(7), factory: contract(8),
    },
    auction_wasm_hash: "fc08e9c6630c3f21b2c8b6450c101657c9df4fc356f25567a08bf4bab0562a62",
    auditor: { id: 0, key: "ab".repeat(64) },
    fee_wallet: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    wasm_sha256: { confidential_token: PINNED_WASM_SHA256.confidential_token },
    token_vks: {},
    pending: [],
  };
}

describe("localnet (S-13)", () => {
  it("parseDeployment reads the contracts deploy json", () => {
    const d = parseDeployment(deployJson());
    expect(d.networkPassphrase).toBe(LOCALNET.networkPassphrase);
    expect(d.contracts.token).toBe(contract(4));
    expect(d.contracts.bidVerifier).toBe(contract(5));
    expect(d.contracts.factory).toBe(contract(8));
    expect(d.auditor).toEqual({ id: 0, key: "ab".repeat(64) });
  });

  it.each(["token", "verifier", "factory", "bid_verifier"])("parseDeployment rejects a json without contracts.%s", (key) => {
    const j = deployJson();
    delete (j.contracts as Record<string, unknown>)[key];
    expect(() => parseDeployment(j)).toThrow(/contracts\./);
  });

  it("parseDeployment rejects an address that is not a contract id", () => {
    const j = deployJson();
    (j.contracts as Record<string, unknown>).token = "not-an-address";
    expect(() => parseDeployment(j)).toThrow(/contracts\.token/);
  });

  it("auditorKeyHex is the 128-hex encoding of a·TOKEN_H (K_aud do demo e do deploy dos contratos)", () => {
    const hex = auditorKeyHex(123_456_789n);
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
    expect(pointFromBytes(Buffer.from(hex, "hex"))).toEqual(scalarMul(123_456_789n, TOKEN_H));
  });

  it("the pinned token wasm sha256 matches the wasm the contracts deploy", () => {
    for (const [name, sha] of Object.entries(PINNED_WASM_SHA256)) {
      const bytes = readFileSync(`${REPO}contracts/wasm/${name}.wasm`);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(sha);
    }
  });

  it("TOKEN_VK_CIRCUITS follows the CircuitType enum of the token verifier (0..5)", () => {
    expect(TOKEN_VK_CIRCUITS).toEqual(["register", "withdraw", "transfer", "spender_transfer", "set_spender", "revoke_spender"]);
  });

  it("localnet.sh pins the quickstart image by digest", () => {
    const script = readFileSync(`${REPO}scripts/localnet.sh`, "utf8");
    expect(script).toMatch(/stellar\/quickstart:[\w.-]+@sha256:[0-9a-f]{64}/);
  });
});
