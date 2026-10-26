import type { ArtifactSet, CircuitName } from "@zolvency-cmi/artifacts";
import {
  browserBackendLoader,
  createProver,
  type NoirInputs,
  type ProofResult,
  type Prover,
} from "@zolvency-cmi/core";

export class LazyProver implements Prover {
  readonly #loadArtifacts: () => Promise<ArtifactSet>;
  #inner: Promise<Prover> | null = null;

  constructor(loadArtifacts: () => Promise<ArtifactSet>) {
    this.#loadArtifacts = loadArtifacts;
  }

  #get(): Promise<Prover> {
    this.#inner ??= this.#loadArtifacts().then((artifacts) =>
      createProver({
        artifacts,
        backendLoader: browserBackendLoader(),
        threads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)),
      }),
    );
    this.#inner.catch(() => {
      this.#inner = null;
    });
    return this.#inner;
  }

  async execute(circuit: CircuitName, inputs: NoirInputs): Promise<void> {
    return (await this.#get()).execute(circuit, inputs);
  }

  async prove(circuit: CircuitName, inputs: NoirInputs): Promise<ProofResult> {
    return (await this.#get()).prove(circuit, inputs);
  }

  async verify(circuit: CircuitName, result: ProofResult): Promise<boolean> {
    return (await this.#get()).verify(circuit, result);
  }

  async verificationKey(circuit: CircuitName): Promise<Uint8Array> {
    return (await this.#get()).verificationKey(circuit);
  }

  async destroy(): Promise<void> {
    const inner = this.#inner;
    this.#inner = null;
    if (inner !== null) await (await inner).destroy();
  }
}
