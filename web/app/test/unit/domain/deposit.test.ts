import { describe, expect, it } from "vitest";

import { suggestDeposit } from "@/domain/deposit";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("suggestDeposit", () => {
  it("never suggests exactly the amount needed (F-12)", () => {
    for (let i = 1; i <= 500; i++) {
      const needed = BigInt(i) * 13_777_777n;
      const suggestion = suggestDeposit(needed, seeded(i));
      expect(suggestion).toBeGreaterThan(needed);
      expect(suggestion).not.toBe(needed);
    }
  });

  it("rounds the suggestion to 0,1 XLM", () => {
    const suggestion = suggestDeposit(41_234_567n, seeded(7));
    expect(suggestion % 1_000_000n).toBe(0n);
  });

  it("suggests a starting amount even when nothing is needed", () => {
    expect(suggestDeposit(0n, seeded(1))).toBeGreaterThan(0n);
  });

  it("rejects a negative need", () => {
    expect(() => suggestDeposit(-1n, seeded(1))).toThrow();
  });

  it("is stable for the same random input", () => {
    expect(suggestDeposit(7_000_000n, seeded(42))).toBe(suggestDeposit(7_000_000n, seeded(42)));
  });
});
