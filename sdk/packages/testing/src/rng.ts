import { sha256 } from "@noble/hashes/sha2";

import { sampleField, sampleScalar, type Rng } from "@zolvency-cmi/core";

export class SeededRng implements Rng {
  readonly #seed: Uint8Array;
  #counter = 0;

  constructor(seed: string | bigint) {
    this.#seed = new TextEncoder().encode(`cmi-test-rng:${seed.toString()}`);
  }

  #next32 = (): Uint8Array => {
    const block = new Uint8Array(this.#seed.length + 8);
    block.set(this.#seed);
    new DataView(block.buffer).setBigUint64(this.#seed.length, BigInt(this.#counter++));
    return sha256(block);
  };

  field(): bigint {
    return sampleField(this.#next32);
  }

  scalar(): bigint {
    return sampleScalar(this.#next32);
  }
}
