import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };

const PINNED = "9500ed774b13b08b5fe99370b60de3479edb492b";
const SUBMODULE = fileURLToPath(new URL("../../../../third_party/stellar-confidential-token-demo", import.meta.url));

describe("@ctd/sdk dependency", () => {
  it("comes from the submodule pinned at the POC commit", () => {
    const head = execFileSync("git", ["-C", SUBMODULE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(head).toBe(PINNED);
  });

  it("is a workspace devDependency of core, embedded in the published build", () => {
    expect((pkg.devDependencies as Record<string, string>)["@ctd/sdk"]).toBe("workspace:*");
    expect((pkg.dependencies as Record<string, string>)["@ctd/sdk"]).toBeUndefined();
  });

  it("no vendored copy remains in core", () => {
    expect(existsSync(fileURLToPath(new URL("../../vendor", import.meta.url)))).toBe(false);
  });
});
