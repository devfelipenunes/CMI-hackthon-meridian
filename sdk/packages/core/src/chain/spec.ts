import { contract } from "@stellar/stellar-sdk";

export function specEntriesFromWasm(wasm: Uint8Array): string[] {
  return contract.Spec.fromWasm(Buffer.from(wasm)).entries.map((e) => e.toXDR("base64"));
}
