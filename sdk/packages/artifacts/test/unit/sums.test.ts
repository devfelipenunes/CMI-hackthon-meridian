import { describe, expect, it } from "vitest";

import { parseSha256Sums } from "../../src/index.js";

describe("parseSha256Sums", () => {
  it("parses sha256sum output with optional binary marker", () => {
    const sums = parseSha256Sums(`${"a".repeat(64)}  circuits/x.json\n${"b".repeat(64)} *vks/x.vk.bin\n`);
    expect(sums.get("circuits/x.json")).toBe("a".repeat(64));
    expect(sums.get("vks/x.vk.bin")).toBe("b".repeat(64));
  });

  it("rejects a malformed line", () => {
    expect(() => parseSha256Sums("not-a-hash  file\n")).toThrow();
  });
});
