import type { UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit as NoirCompiledCircuit } from "@noir-lang/noir_js";
import type { ArtifactSet, CircuitName } from "@zolvency-cmi/artifacts";

import { CmiError } from "../errors/CmiError.js";
import { defaultBackendLoader, type UltraHonkBackendCtor } from "../platform/node/bb-loader.js";

export type NoirInputs = Record<string, string | string[]>;

export interface ProofResult {

  proof: Uint8Array;

  publicInputs: string[];
}

export interface Prover {

  execute(circuit: CircuitName, inputs: NoirInputs): Promise<void>;
  prove(circuit: CircuitName, inputs: NoirInputs): Promise<ProofResult>;
  verify(circuit: CircuitName, result: ProofResult): Promise<boolean>;
  verificationKey(circuit: CircuitName): Promise<Uint8Array>;
  destroy(): Promise<void>;
}

const KECCAK = { keccak: true } as const;

interface Entry {
  noir: Noir;
  bytecode: string;
  backend?: UltraHonkBackend;
}

export function createProver(opts: {
  artifacts: ArtifactSet;
  backendLoader?: () => Promise<UltraHonkBackendCtor>;
  threads?: number;
}): Prover {
  const load = opts.backendLoader ?? defaultBackendLoader;
  const entries = new Map<CircuitName, Entry>();

  function entry(name: CircuitName): Entry {
    let e = entries.get(name);
    if (!e) {
      let circuit;
      try {
        circuit = opts.artifacts.circuit(name);
      } catch (cause) {
        throw new CmiError("ArtifactNotFound", `circuit ${name} is not in the artifact set`, { cause });
      }
      e = { noir: new Noir(circuit as unknown as NoirCompiledCircuit), bytecode: circuit.bytecode };
      entries.set(name, e);
    }
    return e;
  }

  async function backend(e: Entry): Promise<UltraHonkBackend> {
    if (!e.backend) {
      const Backend = await load();
      e.backend = new Backend(e.bytecode, opts.threads === undefined ? undefined : { threads: opts.threads });
    }
    return e.backend;
  }

  async function solve(name: CircuitName, inputs: NoirInputs): Promise<Uint8Array> {
    const e = entry(name);
    try {
      return (await e.noir.execute(inputs)).witness;
    } catch {

      throw new CmiError("ProofFailed", `the inputs do not satisfy circuit ${name}`);
    }
  }

  return {
    async execute(name, inputs) {
      await solve(name, inputs);
    },
    async prove(name, inputs) {
      const witness = await solve(name, inputs);
      const { proof, publicInputs } = await (await backend(entry(name))).generateProof(witness, KECCAK);
      return { proof, publicInputs };
    },
    async verify(name, result) {
      return (await backend(entry(name))).verifyProof(result, KECCAK);
    },
    async verificationKey(name) {
      return (await backend(entry(name))).getVerificationKey(KECCAK);
    },
    async destroy() {
      await Promise.all([...entries.values()].map((e) => e.backend?.destroy()));
      entries.clear();
    },
  };
}
