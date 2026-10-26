import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { Secret } from "@zolvency-cmi/core";

import { ServiceError } from "../errors.js";

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function seal(master: Secret<Buffer>, name: string, plaintext: Secret<string>): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master.expose(), iv);
  c.setAAD(Buffer.from(name, "utf8"));
  const ciphertext = Buffer.concat([c.update(plaintext.expose(), "utf8"), c.final()]);
  return { ciphertext, iv, tag: c.getAuthTag() };
}

export function unseal(master: Secret<Buffer>, name: string, s: Sealed): Secret<string> {
  try {
    const d = createDecipheriv("aes-256-gcm", master.expose(), s.iv);
    d.setAAD(Buffer.from(name, "utf8"));
    d.setAuthTag(s.tag);
    return new Secret(Buffer.concat([d.update(s.ciphertext), d.final()]).toString("utf8"));
  } catch {
    throw new ServiceError("MasterKeyInvalid", `key "${name}" does not open with this master key`);
  }
}

export function loadMasterKey(src: { file: string } | { hex: string }, readFile: (p: string) => string = (p) => readFileSync(p, "utf8")): Secret<Buffer> {
  let hex: string;
  try {
    hex = ("file" in src ? readFile(src.file) : src.hex).trim();
  } catch {
    throw new ServiceError("MasterKeyInvalid", "the master key file cannot be read");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new ServiceError("MasterKeyInvalid", "the master key must be 32 bytes in hex");
  return new Secret(Buffer.from(hex, "hex"));
}

export function newMasterKeyHex(): string {
  return randomBytes(32).toString("hex");
}
