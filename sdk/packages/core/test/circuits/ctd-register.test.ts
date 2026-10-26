import { Noir } from "@noir-lang/noir_js";
import { describe, expect, it } from "vitest";

import { addressToField, buildRegisterWitness, deriveKeys } from "@ctd/sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";

const TOKEN = "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F";

describe("ctd-sdk register witness", () => {
  const circuit = loadDevArtifacts().circuit("register");
  const keys = deriveKeys(123456789n, addressToField(TOKEN));

  it("executes against the pinned register circuit", async () => {
    const noir = new Noir(circuit as never);
    await expect(noir.execute(buildRegisterWitness(keys).inputs)).resolves.toBeDefined();
  });

  it("fails when sk does not match Y", async () => {
    const noir = new Noir(circuit as never);
    const inputs = { ...buildRegisterWitness(keys).inputs, sk: "0x01" };
    await expect(noir.execute(inputs)).rejects.toThrow();
  });
});
