import { createHash } from "node:crypto";

import { xdr } from "@stellar/stellar-sdk";

import { fail } from "./cli.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `pointToBytes` e `Y` têm o mesmo formato (64 bytes, `be(x) || be(y)`). */
export function operatorKeyIdFromY(y: Uint8Array): string {
  if (y.length !== 64) fail(`Y do register_data tem ${y.length} bytes; esperava 64`);
  return sha256Hex(y);
}

function mapOf(v: xdr.ScVal, what: string): Map<string, xdr.ScVal> {
  if (v.switch().name !== "scvMap" || v.map() === null) fail(`${what} do register_data não é um struct XDR`);
  const out = new Map<string, xdr.ScVal>();
  for (const entry of v.map()!) {
    const key = entry.key();
    if (key.switch().name !== "scvSymbol") fail(`${what} do register_data tem uma chave que não é símbolo`);
    out.set(key.sym().toString(), entry.val());
  }
  return out;
}

/**
 * O `register_data` é `Bytes` contendo o XDR de `{ payload: { y, pvk }, proof }`
 * (@ctd/sdk, `encodeRegisterData`). Só o `Y` público é lido daqui — o `sk_op` nunca passa por aqui.
 */
export function decodeRegisterData(bytes: Uint8Array): { operatorKeyId: string; y: Uint8Array } {
  let envelope: xdr.ScVal;
  try {
    envelope = xdr.ScVal.fromXDR(Buffer.from(bytes));
  } catch {
    return fail("register_data não é um ScVal XDR válido");
  }
  // `encodeRegisterData` do SDK devolve os bytes do struct; um export do operador pode vir
  // embrulhado em `scvBytes` (o argumento `Bytes`). Aceitamos as duas formas.
  if (envelope.switch().name === "scvBytes") {
    try {
      envelope = xdr.ScVal.fromXDR(Buffer.from(envelope.bytes()));
    } catch {
      return fail("o conteúdo do register_data não é um XDR válido");
    }
  }
  const fields = mapOf(envelope, "envelope");
  if (!fields.has("proof")) fail("register_data sem proof");

  const payloadVal = fields.get("payload");
  if (payloadVal === undefined) fail("register_data sem payload");
  const payload = mapOf(payloadVal, "payload");
  const yVal = payload.get("y");
  if (yVal === undefined || yVal.switch().name !== "scvBytes") fail("register_data sem o ponto Y");
  const y = new Uint8Array(yVal.bytes());
  if (!payload.has("pvk")) fail("register_data sem o ponto PVK");

  return { operatorKeyId: operatorKeyIdFromY(y), y };
}

export function decodeBase64RegisterData(text: string): Uint8Array {
  const clean = text.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) {
    return fail("CMI_REGISTER_DATA não é base64 válido");
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}
