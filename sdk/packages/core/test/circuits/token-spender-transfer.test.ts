import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { describe, expect, it } from "vitest";

import { createProver } from "../../src/index.js";
import { legsScenario } from "../helpers/legs.js";

describe("spender_transfer witness", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  const { legs } = legsScenario();

  it.each(["seller", "fee", "refund"] as const)("spender_transfer witness executes against circuit (%s leg)", async (leg) => {
    await expect(prover.execute("spender_transfer", legs[leg].inputs)).resolves.toBeUndefined();
  });
});
