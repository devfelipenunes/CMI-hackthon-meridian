import { afterEach, describe, expect, it, vi } from "vitest";

import { FR_MODULUS, cryptoRng } from "../../src/index.js";

describe("cryptoRng", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses crypto.getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    cryptoRng.field();
    cryptoRng.scalar();
    expect(spy).toHaveBeenCalled();
  });

  it("field is in [0, r) and scalar in [1, r)", () => {
    for (let i = 0; i < 50; i++) {
      const f = cryptoRng.field();
      const s = cryptoRng.scalar();
      expect(f >= 0n && f < FR_MODULUS).toBe(true);
      expect(s >= 1n && s < FR_MODULUS).toBe(true);
    }
  });

  it("two draws differ", () => {
    expect(cryptoRng.field()).not.toBe(cryptoRng.field());
  });
});
