import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { createProver } from "../../src/index.js";
import { revokeScenario } from "../helpers/revoke.js";

describe("revoke_spender witness", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });

  it("revoke_spender witness executes against circuit", async () => {
    await expect(prover.execute("revoke_spender", revokeScenario().revoke.inputs)).resolves.toBeUndefined();
  });
});
