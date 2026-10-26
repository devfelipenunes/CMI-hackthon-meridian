import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Address, Keypair, Networks, rpc, xdr } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { LOCALNET, PINNED_WASM_SHA256, TOKEN_VK_CIRCUITS, fundAccount, loadLocalDeployment, localChain } from "../../src/index.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const server = new rpc.Server(LOCALNET.rpcUrl, { allowHttp: true });

describe("rede local (quickstart) + conjunto do token", () => {
  it("localnet is up and protocol supports bn254 and poseidon2 host functions", async () => {
    const net = await server.getNetwork();
    expect(net.passphrase).toBe(Networks.STANDALONE);

    expect(net.protocolVersion).toBeGreaterThanOrEqual(25);

    const dep = loadLocalDeployment();
    const fixture = `${REPO}contracts/artifacts/fixtures/bid_validity/valid_ana/`;
    await localChain(dep).simulate(dep.contracts.bidVerifier, "verify_proof", [
      xdr.ScVal.scvBytes(readFileSync(`${fixture}public_inputs`)),
      xdr.ScVal.scvBytes(readFileSync(`${fixture}proof`)),
    ]);
  });

  it("token set deploys and reports its addresses", async () => {
    const dep = loadLocalDeployment();
    expect(dep.networkPassphrase).toBe(Networks.STANDALONE);
    const someone = new Address(Keypair.random().publicKey()).toScVal();
    const isSpender = await localChain(dep).simulate(dep.contracts.token, "is_spender", [someone, someone]);
    expect(isSpender.b()).toBe(false);
  });

  it("deployed token wasm sha256 equals pinned", async () => {
    const dep = loadLocalDeployment();
    const wasm = await server.getContractWasmByContractId(dep.contracts.token);
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(PINNED_WASM_SHA256.confidential_token);
  });

  it.each(TOKEN_VK_CIRCUITS.map((name, i) => [name, i] as const))(
    "each token VK registered in our verifier equals the artifact VK (%s)",
    async (name, circuitType) => {
      const dep = loadLocalDeployment();
      const vk = await localChain(dep).simulate(dep.contracts.verifier, "get_verification_key", [xdr.ScVal.scvU32(circuitType)]);
      expect(new Uint8Array(vk.bytes())).toEqual(loadDevArtifacts().vk(name));
    },
  );

  it("friendbot funds a fresh account", async () => {
    const kp = Keypair.random();
    await fundAccount(kp.publicKey());
    const account = await server.getAccount(kp.publicKey());
    expect(account.accountId()).toBe(kp.publicKey());
  });
});
