import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { VERSION } from "../../src/index.js";

describe("@zolvency-cmi/client", () => {
  it("exports a version string equal to package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
