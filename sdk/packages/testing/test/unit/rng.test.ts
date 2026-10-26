import { describe, expect, it } from "vitest";

import { FR_MODULUS } from "@zolvency-cmi/core";

import { SeededRng } from "../../src/index.js";

describe("SeededRng", () => {
  it("is deterministic per seed", () => {
    const a = new SeededRng("aurora");
    const b = new SeededRng("aurora");
    expect([a.field(), a.scalar(), a.field()]).toEqual([b.field(), b.scalar(), b.field()]);
  });

  it("different seeds differ", () => {
    expect(new SeededRng("ana").field()).not.toBe(new SeededRng("bruno").field());
  });

  it("successive draws differ", () => {
    const r = new SeededRng(1n);
    expect(r.field()).not.toBe(r.field());
  });

  it("values are in range", () => {
    const r = new SeededRng("range");
    for (let i = 0; i < 100; i++) {
      const s = r.scalar();
      expect(s >= 1n && s < FR_MODULUS).toBe(true);
    }
  });
});
