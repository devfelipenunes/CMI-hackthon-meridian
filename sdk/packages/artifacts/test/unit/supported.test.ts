import { describe, expect, it } from "vitest";

import { SUPPORTED_CONTRACTS_TAGS } from "../../src/index.js";

describe("SUPPORTED_CONTRACTS_TAGS", () => {
  it("is the contracts v0.1.0", () => {
    expect([...SUPPORTED_CONTRACTS_TAGS]).toEqual(["v0.1.0"]);
  });
});
