import { addressToField, buildRegisterWitness, deriveKeys } from "@ctd/sdk";
import { ArtifactSet } from "@zolvency-cmi/artifacts";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { createProver } from "../../src/index.js";

const TOKEN = "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F";
const SK = 0x1234_5678_9abc_def0_1357_9bdfn;

describe("Prover.execute", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  const inputs = buildRegisterWitness(deriveKeys(SK, addressToField(TOKEN))).inputs;

  it("succeeds on valid register witness", async () => {
    await expect(prover.execute("register", inputs)).resolves.toBeUndefined();
  });

  it("fails with ProofFailed on tampered witness", async () => {
    await expect(prover.execute("register", { ...inputs, sk: "0x02" })).rejects.toMatchObject({
      code: "ProofFailed",
    });
  });

  it("the ProofFailed error does not carry the witness secret (S-16)", async () => {
    const err = await prover.execute("register", { ...inputs, sk: "0x5eed5eed5eed5eed" }).catch((e: unknown) => e);
    const text = JSON.stringify(err, Object.getOwnPropertyNames(err as object)) + String(err) + String((err as Error).stack);
    expect(text.toLowerCase()).not.toContain("5eed5eed5eed5eed");
    expect(text.toLowerCase()).not.toContain(SK.toString(16));
  });

  it("rejects an unknown circuit with ArtifactNotFound", async () => {
    const empty = createProver({ artifacts: new ArtifactSet(new Map(), new Map(), { contractsTag: null }) });
    await expect(empty.execute("winner_allocation", inputs)).rejects.toMatchObject({ code: "ArtifactNotFound" });
  });
});
