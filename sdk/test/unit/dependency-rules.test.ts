import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { cruise, type IViolation } from "dependency-cruiser";
import { beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURES = fileURLToPath(new URL("../fixtures/depcruise", import.meta.url));

let violations: IViolation[] = [];

beforeAll(async () => {
  const config = require("../../.dependency-cruiser.cjs") as { forbidden: unknown[] };
  const result = await cruise(["packages"], {
    baseDir: FIXTURES,
    validate: true,
    ruleSet: { forbidden: config.forbidden } as never,
  });
  if (typeof result.output === "string") throw new Error("unexpected string output");
  violations = result.output.summary.violations;
});

function rulesFor(fromSuffix: string): string[] {
  return violations.filter((v) => v.from.endsWith(fromSuffix)).map((v) => v.rule.name);
}

describe("dependency rules", () => {
  it("reject client → operator", () => {
    expect(rulesFor("client/src/bad-imports-operator.ts")).toContain("client-not-operator");
  });

  it("operator package cannot be imported from client (real case: the operator keystore, 4.3)", () => {
    expect(rulesFor("client/src/bad-imports-operator-keystore.ts")).toContain("client-not-operator");
  });

  it("allow client → core", () => {
    expect(rulesFor("client/src/ok-imports-core.ts")).toEqual([]);
  });

  it("reject node:* in core", () => {
    expect(rulesFor("core/src/bad-node-builtin.ts")).toContain("core-no-node-builtins");
  });

  it("allow node:* in core/src/platform/node", () => {
    expect(rulesFor("core/src/platform/node/ok-node-builtin.ts")).toEqual([]);
  });

  it("reject published package → testing", () => {
    expect(rulesFor("core/src/bad-imports-testing.ts")).toContain("published-not-testing");
  });
});
