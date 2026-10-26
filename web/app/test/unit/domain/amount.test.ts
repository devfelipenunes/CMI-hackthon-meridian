import { describe, expect, it } from "vitest";

import { formatQuotas, formatXlm, parseQuotas, parseXlm, quotaValue } from "@/domain/amount";

describe("parseXlm / formatXlm", () => {
  it("parses whole and fractional amounts with seven decimals", () => {
    expect(parseXlm("1")).toBe(10_000_000n);
    expect(parseXlm("1.5")).toBe(15_000_000n);
    expect(parseXlm("1,234.5")).toBe(12_345_000_000n);
    expect(parseXlm("0.0000001")).toBe(1n);
    expect(parseXlm(" 12.3456789 ")).toBe(123_456_789n);
  });

  it("keeps precision above 2^53", () => {
    const big = 9_007_199_254_740_993n;
    expect(parseXlm(formatXlm(big))).toBe(big);
    expect(formatXlm(123_456_789_012_345_678n)).toBe("12,345,678,901.2345678");
  });

  it("rejects malformed, negative, exponent and over-precise input", () => {
    for (const bad of ["", " ", "-1", "1e3", "1.2.3", "1,2,3", "1,5", "1,00000001", ".5", "1.", "abc"]) {
      expect(() => parseXlm(bad), bad).toThrow();
    }
  });

  it("formats up to seven decimals and trims zeros", () => {
    expect(formatXlm(10_000_000n)).toBe("1");
    expect(formatXlm(1_500_000n)).toBe("0.15");
    expect(formatXlm(1n)).toBe("0.0000001");
    expect(formatXlm(0n)).toBe("0");
    expect(formatXlm(-25_000_000n)).toBe("-2.5");
  });

  it("honours maxFractionDigits", () => {
    expect(formatXlm(12_345_678n, { maxFractionDigits: 2 })).toBe("1.23");
    expect(formatXlm(12_300_000n, { maxFractionDigits: 0 })).toBe("1");
  });
});

describe("quotas", () => {
  it("parses positive integers only", () => {
    expect(parseQuotas("10")).toBe(10);
    expect(() => parseQuotas("0")).toThrow();
    expect(() => parseQuotas("-1")).toThrow();
    expect(() => parseQuotas("1.5")).toThrow();
    expect(() => parseQuotas("4294967296")).toThrow();
  });

  it("formats with an en-US thousands separator and singular", () => {
    expect(formatQuotas(1)).toBe("1 quota");
    expect(formatQuotas(10)).toBe("10 quotas");
    expect(formatQuotas(1_234)).toBe("1,234 quotas");
  });

  it("computes the public value of a bid without floating point", () => {
    expect(quotaValue(3n, 40_000_000n)).toBe(120_000_000n);
    expect(quotaValue(0n, 40_000_000n)).toBe(0n);
    expect(() => quotaValue(-1n, 1n)).toThrow();
  });
});
