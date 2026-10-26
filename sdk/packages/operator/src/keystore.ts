import type { Scalar, Secret, Signer } from "@zolvency-cmi/core";

export interface OperatorKeyStore {

  spenderKey(): Promise<Secret<Scalar>>;

  envelopeKey(): Promise<Secret<Scalar>>;

  submitter(): Promise<Signer>;
}

export class InMemoryOperatorKeyStore implements OperatorKeyStore {
  readonly #spender: Secret<Scalar>;
  readonly #envelope: Secret<Scalar>;
  readonly #submitter: Signer;

  constructor(keys: { spenderKey: Secret<Scalar>; envelopeKey: Secret<Scalar>; submitter: Signer }) {
    this.#spender = keys.spenderKey;
    this.#envelope = keys.envelopeKey;
    this.#submitter = keys.submitter;
  }

  async spenderKey(): Promise<Secret<Scalar>> {
    return this.#spender;
  }

  async envelopeKey(): Promise<Secret<Scalar>> {
    return this.#envelope;
  }

  async submitter(): Promise<Signer> {
    return this.#submitter;
  }
}
