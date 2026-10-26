import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { addressToField, buildRegisterWitness, createProver, deriveTokenKeys } from "../../src/index.js";

describe("register witness", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  const contract = "CD4E4XLXJVX346V754HW6T77IC5CWG5IZROUMIRGEZYTXWW7O4O765B6";

  it("register witness executes against register circuit (contract account)", async () => {
    const keys = deriveTokenKeys(0x0abc_def0_1234n, addressToField(contract));
    await expect(prover.execute("register", buildRegisterWitness(keys).inputs)).resolves.toBeUndefined();
  });
});
