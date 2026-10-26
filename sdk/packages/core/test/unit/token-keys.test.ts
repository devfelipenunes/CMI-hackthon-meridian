import { addressToField as ctdAddressToField, encodeRegisterData as ctdEncodeRegisterData, buildRegisterWitness as ctdBuildRegister, deriveKeys } from "@ctd/sdk";
import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  FR_MODULUS,
  Secret,
  TOKEN_H,
  addressToField,
  buildRegisterWitness,
  deriveTokenKeys,
  encodeRegisterData,
  generateTokenKeys,
  scalarMul,
} from "../../src/index.js";

const TOKEN = "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F";
const OTHER_TOKEN = "CDDP6V3GFM44B5XD7YGWN4WLSEUAVZG2FYMK3UKH7DTBRBFN7CTFP3Y5";
const ACCOUNT = "GDYWZQYPXOS3ALAAXMEUL4A6ZDMXKVVONTJEZOLE6DLT7WJRN666VBOV";
const SK = 0x0123_4567_89ab_cdef_fedc_ba98_7654_3210n;

describe("token keys", () => {
  it("deriveTokenKeys is deterministic for (sk, addrF)", () => {
    const a = deriveTokenKeys(SK, addressToField(TOKEN));
    const b = deriveTokenKeys(SK, addressToField(TOKEN));
    expect(a.vk.expose()).toBe(b.vk.expose());
    expect(a.Y).toEqual(b.Y);
    expect(a.PVK).toEqual(b.PVK);
  });

  it("keys are bound to token address (another addrF gives another vk)", () => {
    const a = deriveTokenKeys(SK, addressToField(TOKEN));
    const b = deriveTokenKeys(SK, addressToField(OTHER_TOKEN));
    expect(a.vk.expose()).not.toBe(b.vk.expose());
    expect(a.Y).toEqual(b.Y);
  });

  it("Y = sk·H and PVK = vk·H, equal to the ctd-sdk derivation", () => {
    const k = deriveTokenKeys(SK, addressToField(TOKEN));
    const ctd = deriveKeys(SK, addressToField(TOKEN));
    expect(k.Y).toEqual(scalarMul(SK, TOKEN_H));
    expect(k.PVK).toEqual(scalarMul(k.vk.expose(), TOKEN_H));
    expect(k.vk.expose()).toBe(ctd.vk);
  });

  it("sk and vk are Secret", () => {
    const k = deriveTokenKeys(SK, addressToField(TOKEN));
    expect(k.sk).toBeInstanceOf(Secret);
    expect(k.vk).toBeInstanceOf(Secret);
    const json = JSON.stringify(k, (_k, v) => (typeof v === "bigint" ? `${v.toString()}|${v.toString(16)}` : v));
    expect(json).not.toContain(SK.toString());
    expect(json).not.toContain(SK.toString(16));
    expect(json).not.toContain(k.vk.expose().toString(16));
  });

  it("rejects sk outside [1, r)", () => {
    expect(() => deriveTokenKeys(0n, addressToField(TOKEN))).toThrow(RangeError);
    expect(() => deriveTokenKeys(FR_MODULUS, addressToField(TOKEN))).toThrow(RangeError);
  });

  it("generateTokenKeys draws sk from the injected Rng", () => {
    const rng = { field: vi.fn(), scalar: vi.fn(() => SK) };
    const k = generateTokenKeys(addressToField(TOKEN), rng);
    expect(rng.scalar).toHaveBeenCalledOnce();
    expect(k.sk.expose()).toBe(SK);
  });
});

describe("addressToField", () => {
  it.each([TOKEN, ACCOUNT])("matches ctd-sdk for %s", (address) => {
    expect(addressToField(address)).toBe(ctdAddressToField(address));
  });

  it("rejects a string that is not a 56-char strkey", () => {
    expect(() => addressToField("GABC")).toThrow(RangeError);
  });
});

describe("register data codec", () => {
  const keys = deriveTokenKeys(SK, addressToField(ACCOUNT));
  const proof = Uint8Array.from({ length: 14_592 }, (_, i) => i % 251);

  it("register witness payload is (Y, PVK)", () => {
    const w = buildRegisterWitness(keys);
    expect(w.payload).toEqual({ y: keys.Y, pvk: keys.PVK });
  });

  it("encodeRegisterData is the same bytes as the ctd-sdk/POC-5 codec", () => {
    const ours = encodeRegisterData(buildRegisterWitness(keys), proof);
    const ctd = ctdEncodeRegisterData(ctdBuildRegister(deriveKeys(SK, addressToField(ACCOUNT))), proof).bytes();
    expect(Buffer.from(ours).equals(Buffer.from(ctd))).toBe(true);
  });

  it("encodeRegisterData is XDR {payload, proof} with sorted keys", () => {
    const map = xdr.ScVal.fromXDR(Buffer.from(encodeRegisterData(buildRegisterWitness(keys), proof))).map()!;
    expect(map.map((e) => e.key().sym().toString())).toEqual(["payload", "proof"]);
    const payload = map[0]!.val().map()!;
    expect(payload.map((e) => e.key().sym().toString())).toEqual(["pvk", "y"]);
    expect(payload.map((e) => e.val().bytes().length)).toEqual([64, 64]);
    expect(Buffer.from(map[1]!.val().bytes()).equals(Buffer.from(proof))).toBe(true);
  });
});
