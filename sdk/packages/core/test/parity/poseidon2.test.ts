import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DOMAIN, EMPTY_LEAF, FR_MODULUS, MAX_BIDS, poseidon2Hash } from "../../src/index.js";
import vectors from "../vectors/cmi-lib.json" with { type: "json" };

const DOMAINS_NR = fileURLToPath(
  new URL("../../../../contracts/circuits/cmi_lib/src/domains.nr", import.meta.url),
);

describe("poseidon2Hash", () => {
  it.each(vectors.poseidon2.map((v) => [v.inputs.length, v.inputs, v.out, v.from] as const))(
    "matches the %s-input vector (%#)",
    (_n, inputs, out) => {
      expect(poseidon2Hash(inputs.map(BigInt))).toBe(BigInt(out));
    },
  );

  it("inputs longer than RATE are absorbed, not overwritten", () => {
    const multiBlock = vectors.poseidon2.filter((v) => v.inputs.length > 3);
    expect(multiBlock.map((v) => v.inputs.length).sort()).toEqual([4, 4, 5, 6, 8]);
    for (const v of multiBlock) expect(poseidon2Hash(v.inputs.map(BigInt))).toBe(BigInt(v.out));
  });

  it("rejects an input that is not a field element (no silent reduction)", () => {
    expect(() => poseidon2Hash([1n, FR_MODULUS])).toThrow(RangeError);
    expect(() => poseidon2Hash([-1n])).toThrow(RangeError);
  });

  it("rejects an empty input", () => {
    expect(() => poseidon2Hash([])).toThrow(RangeError);
  });
});

describe("domain constants", () => {
  it("equal contracts constants (cmi_lib/src/domains.nr)", () => {
    const nr = readFileSync(DOMAINS_NR, "utf8");
    const global = (name: string) => {
      const m = new RegExp(`pub global ${name}: \\w+ = (\\d+);`).exec(nr);
      if (!m) throw new Error(`${name} not found in domains.nr`);
      return BigInt(m[1]!);
    };
    expect(DOMAIN.BID_COMMIT).toBe(global("BID_COMMIT_DOMAIN"));
    expect(DOMAIN.BID_ENVELOPE_MASK).toBe(global("BID_ENVELOPE_MASK_DOMAIN"));
    expect(DOMAIN.BID_LEAF).toBe(global("BID_LEAF_DOMAIN"));
    expect(DOMAIN.NULLIFIER).toBe(global("NULLIFIER_DOMAIN"));
    expect(EMPTY_LEAF).toBe(global("EMPTY_LEAF"));
    expect(BigInt(MAX_BIDS)).toBe(global("MAX_BIDS"));
  });

  it("are frozen", () => {
    expect(Object.isFrozen(DOMAIN)).toBe(true);
  });
});
