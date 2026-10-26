import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

import { ArtifactError } from "./errors.js";

export const TOKEN_CIRCUITS = [
  "register",
  "set_spender",
  "spender_transfer",
  "revoke_spender",
  "withdraw",
  "transfer",
] as const;
export const CMI_CIRCUITS = ["bid_validity", "winner_allocation", "settlement_binding"] as const;

export type TokenCircuitName = (typeof TOKEN_CIRCUITS)[number];
export type CmiCircuitName = (typeof CMI_CIRCUITS)[number];
export type CircuitName = TokenCircuitName | CmiCircuitName;

export interface CompiledCircuit {
  bytecode: string;
  abi: unknown;
  noir_version?: string;
  [key: string]: unknown;
}

export class ArtifactSet {
  readonly contractsTag: string | null;
  readonly #files: ReadonlyMap<string, Uint8Array>;
  readonly #sums: ReadonlyMap<string, string>;

  constructor(
    files: ReadonlyMap<string, Uint8Array>,
    sums: ReadonlyMap<string, string>,
    meta: { contractsTag: string | null },
  ) {
    this.#files = files;
    this.#sums = sums;
    this.contractsTag = meta.contractsTag;
  }

  files(): ReadonlyMap<string, Uint8Array> {
    return this.#files;
  }

  sums(): ReadonlyMap<string, string> {
    return this.#sums;
  }

  file(path: string): Uint8Array {
    const bytes = this.#files.get(path);
    if (!bytes) throw new ArtifactError("ArtifactNotFound", path, "arquivo ausente no conjunto");
    return bytes;
  }

  circuit(name: CircuitName): CompiledCircuit {
    const path = `circuits/${name}.json`;
    return JSON.parse(new TextDecoder().decode(this.file(path))) as CompiledCircuit;
  }

  vk(name: CircuitName): Uint8Array {
    return this.file(`vks/${name}.vk.bin`);
  }
}

export function verifyArtifacts(set: ArtifactSet): void {
  const files = set.files();
  for (const [path, expected] of set.sums()) {
    const bytes = files.get(path);
    if (!bytes) throw new ArtifactError("ArtifactMismatch", path, "arquivo listado no SHA256SUMS não encontrado");
    const actual = bytesToHex(sha256(bytes));
    if (actual !== expected) {
      throw new ArtifactError("ArtifactMismatch", path, `sha256 ${actual}, esperado ${expected}`);
    }
  }
  for (const path of files.keys()) {
    if (!set.sums().has(path)) throw new ArtifactError("ArtifactMismatch", path, "arquivo fora do SHA256SUMS");
  }
}
