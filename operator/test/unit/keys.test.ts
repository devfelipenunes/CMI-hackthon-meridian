import { Keypair } from "@stellar/stellar-sdk";
import { BID_VALIDITY_PK_OPERATOR, GRUMPKIN_G, Secret, TOKEN_H, pointToBytes, scalarMul } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { openDb } from "../../src/db/open.js";
import { repos } from "../../src/db/repos.js";
import { loadMasterKey, seal, unseal } from "../../src/keys/seal.js";
import { DbOperatorKeyStore, POC_ENVELOPE_SCALAR, auditorKeyHex, generateKey, samePoint } from "../../src/keys/store.js";

const master = loadMasterKey({ hex: "22".repeat(32) });
const other = loadMasterKey({ hex: "33".repeat(32) });

function store(m = master) {
  const db = openDb(":memory:");
  return { db, keys: new DbOperatorKeyStore(repos(db).keys, m), repo: repos(db).keys };
}

describe("keystore (passos 1.2–1.3, OP-08, OP-10, OP-20)", () => {
  it("seal/open round-trips; another master key or another name does not open", () => {
    const s = seal(master, "spender", new Secret("abc123"));
    expect(unseal(master, "spender", s).expose()).toBe("abc123");
    expect(() => unseal(other, "spender", s)).toThrow(expect.objectContaining({ code: "MasterKeyInvalid" }));
    expect(() => unseal(master, "envelope", s)).toThrow(expect.objectContaining({ code: "MasterKeyInvalid" }));
  });

  it("two seals of the same key differ (random IV)", () => {
    const a = seal(master, "x", new Secret("same"));
    const b = seal(master, "x", new Secret("same"));
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("the master key must be 32 bytes in hex", () => {
    expect(() => loadMasterKey({ hex: "abc" })).toThrow(expect.objectContaining({ code: "MasterKeyInvalid" }));
    expect(() => loadMasterKey({ file: "/nope" }, () => { throw new Error("ENOENT"); })).toThrow(/cannot be read/);
  });

  it("the POC envelope scalar is the PK_operator of the bid_validity circuit", () => {
    expect(samePoint(scalarMul(POC_ENVELOPE_SCALAR, GRUMPKIN_G), BID_VALIDITY_PK_OPERATOR)).toBe(true);
  });

  it("keys import envelope rejects a key whose point is not the circuit PK_operator", () => {
    const { keys } = store();
    expect(() => keys.put("envelope", new Secret("1234"))).toThrow(expect.objectContaining({ code: "EnvelopeKeyMismatch" }));
    expect(() => generateKey("envelope")).toThrow(expect.objectContaining({ code: "EnvelopeKeyMismatch" }));
    keys.put("envelope", new Secret(POC_ENVELOPE_SCALAR.toString(16)));
    expect(keys.has("envelope")).toBe(true);
  });

  it("keys generate spender stores it and its public part is sk_op·H (auditor key, D3)", async () => {
    const { keys } = store();
    const pub = keys.put("spender", new Secret(generateKey("spender")));
    const sk = (await keys.spenderKey()).expose();
    expect(pub).toBe(Buffer.from(pointToBytes(scalarMul(sk, TOKEN_H))).toString("hex"));
    expect(pub).toBe(auditorKeyHex(sk));
    expect(pub).toMatch(/^[0-9a-f]{128}$/);
  });

  it("DbOperatorKeyStore returns Secret values and the submitter signs as its address", async () => {
    const { keys } = store();
    const secret = Keypair.random().secret();
    keys.put("submitter", new Secret(secret));
    const signer = await keys.submitter();
    expect(signer.address).toBe(Keypair.fromSecret(secret).publicKey());
    expect(keys.publicOf("submitter")).toBe(signer.address);
    expect(await keys.spenderKey().catch((e: unknown) => e)).toMatchObject({ code: "KeyNotFound" });
    keys.put("spender", new Secret("abc"));
    const sk = await keys.spenderKey();
    expect(sk).toBeInstanceOf(Secret);
    expect(String(sk)).toBe("[redacted]");
  });

  it("a key is never overwritten; invalid keys are rejected", () => {
    const { keys } = store();
    keys.put("spender", new Secret("abc"));
    expect(() => keys.put("spender", new Secret("def"))).toThrow(expect.objectContaining({ code: "KeyAlreadyExists" }));
    expect(() => keys.put("submitter", new Secret("not-a-secret"))).toThrow(/Stellar secret/);
    expect(() => keys.put("fee_wallet_token", new Secret("0"))).toThrow(/\[1, r\)/);
  });

  it("missing key → KeyNotFound naming the key", () => {
    const { keys } = store();
    expect(() => keys.read("admin")).toThrow(/key "admin" not found/);
  });

  it("keys table holds no plaintext", () => {
    const { keys, db } = store();
    const secret = Keypair.random().secret();
    const sk = 0xabcdef0123456789abcdefn;
    keys.put("submitter", new Secret(secret));
    keys.put("spender", new Secret(sk.toString(16)));
    const rows = db.prepare("SELECT * FROM keys").all() as Record<string, unknown>[];
    const dump = rows.map((r) => Object.values(r).map((v) => (Buffer.isBuffer(v) ? v.toString("latin1") : String(v))).join(" ")).join("\n");
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain(sk.toString(16));
    expect(dump).not.toContain(sk.toString());
  });
});
