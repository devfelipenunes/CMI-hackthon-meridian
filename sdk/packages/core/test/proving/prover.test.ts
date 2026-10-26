import { UltraHonkBackend } from "@aztec/bb.js";
import { addressToField, buildRegisterWitness, deriveKeys } from "@ctd/sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, describe, expect, it } from "vitest";

import { createProver, type ProofResult } from "../../src/index.js";

const TOKEN = "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F";
const artifacts = loadDevArtifacts();
const inputs = buildRegisterWitness(deriveKeys(0x1234_5678_9abc_def0n, addressToField(TOKEN))).inputs;

const calls: Array<{ method: string; options: unknown }> = [];
class SpyBackend extends UltraHonkBackend {
  override generateProof(...args: Parameters<UltraHonkBackend["generateProof"]>) {
    calls.push({ method: "generateProof", options: args[1] });
    return super.generateProof(...args);
  }
  override verifyProof(...args: Parameters<UltraHonkBackend["verifyProof"]>) {
    calls.push({ method: "verifyProof", options: args[1] });
    return super.verifyProof(...args);
  }
  override getVerificationKey(...args: Parameters<UltraHonkBackend["getVerificationKey"]>) {
    calls.push({ method: "getVerificationKey", options: args[0] });
    return super.getVerificationKey(...args);
  }
}

describe("Prover (bb.js, Node)", () => {
  const prover = createProver({ artifacts, backendLoader: async () => SpyBackend });
  let result: ProofResult;

  afterAll(() => prover.destroy());

  it("prove + verify round trip on register", async () => {
    result = await prover.prove("register", inputs);
    expect(await prover.verify("register", result)).toBe(true);
  });

  it("proof is 14592 bytes", () => {
    expect(result.proof.length).toBe(14_592);
  });

  it("a tampered proof does not verify", async () => {
    const proof = new Uint8Array(result.proof);
    proof[200] = proof[200]! ^ 0x01;
    expect(await prover.verify("register", { ...result, proof }).catch(() => false)).toBe(false);
  });

  it("prover vk equals artifact vk", async () => {
    expect(Buffer.from(await prover.verificationKey("register")).equals(Buffer.from(artifacts.vk("register")))).toBe(true);
  });

  it("prover always uses keccak transcript", () => {
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c.options, c.method).toEqual({ keccak: true });
  });
});
