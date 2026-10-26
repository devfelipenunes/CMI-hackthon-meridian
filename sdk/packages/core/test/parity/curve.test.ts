import { describe, expect, it } from "vitest";

import { GRUMPKIN_G, TOKEN_G, TOKEN_H, ecdh, pedersenCommit, scalarMul } from "../../src/index.js";
import vectors from "../vectors/cmi-lib.json" with { type: "json" };

const c = vectors.curve;
const pt = (p: { x: string; y: string }) => ({ x: BigInt(p.x), y: BigInt(p.y) });

describe("curve parity with cmi_lib and Noir", () => {
  it("TOKEN_G and TOKEN_H equal CRYPTO.md constants", () => {
    expect(TOKEN_G).toEqual(pt(c.tokenG));
    expect(TOKEN_H).toEqual(pt(c.tokenH));
  });

  it("pedersenCommit(650·200, 424242424242) matches POC-3 vector", () => {
    expect(pedersenCommit(BigInt(c.commit.value), BigInt(c.commit.randomness))).toEqual(pt(c.commit));
  });

  it("GRUMPKIN_G is Noir's fixed-base generator, not the token G", () => {
    expect(GRUMPKIN_G).toEqual(pt(c.grumpkinG));
    expect(GRUMPKIN_G).not.toEqual(TOKEN_G);
  });

  it("scalarMul(5, GRUMPKIN_G) matches fixed_base_scalar_mul(5)", () => {
    expect(scalarMul(5n, GRUMPKIN_G)).toEqual(pt(c.fiveG));
  });

  it("ecdh returns the full shared point, equal to Noir's multi_scalar_mul", () => {
    const a = BigInt(c.ecdh.a);
    const b = BigInt(c.ecdh.b);
    expect(ecdh(b, scalarMul(a, GRUMPKIN_G))).toEqual(pt(c.ecdh));
  });
});
