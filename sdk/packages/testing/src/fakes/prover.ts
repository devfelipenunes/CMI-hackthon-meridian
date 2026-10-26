import type { CircuitName } from "@zolvency-cmi/artifacts";
import {
  BID_VALIDITY_PUBLIC_INPUTS,
  CmiError,
  SETTLEMENT_BINDING_PUBLIC_INPUTS,
  WINNER_ALLOCATION_PUBLIC_INPUTS,
  type NoirInputs,
  type ProofResult,
  type Prover,
} from "@zolvency-cmi/core";

import type { CallLog } from "./log.js";

export class FakeProver implements Prover {
  readonly proved: { circuit: CircuitName; inputs: NoirInputs }[] = [];
  readonly #log: CallLog | undefined;
  readonly #fail = new Set<CircuitName>();

  constructor(log?: CallLog) {
    this.#log = log;
  }

  failOn(circuit: CircuitName): void {
    this.#fail.add(circuit);
  }

  #check(op: string, circuit: CircuitName, inputs: NoirInputs): void {
    this.#log?.record(`${op}:${circuit}`, false);
    if (this.#fail.has(circuit)) throw new CmiError("ProofFailed", "the inputs do not satisfy the circuit");
    this.proved.push({ circuit, inputs });
  }

  async execute(circuit: CircuitName, inputs: NoirInputs): Promise<void> {
    this.#check("execute", circuit, inputs);
  }

  async prove(circuit: CircuitName, inputs: NoirInputs): Promise<ProofResult> {
    this.#check("prove", circuit, inputs);
    const proof = new Uint8Array(14_592);
    proof[0] = this.proved.length;
    return { proof, publicInputs: publicInputsOf(circuit, inputs) };
  }

  async verify(_circuit: CircuitName, _r: ProofResult): Promise<boolean> {
    return true;
  }

  async verificationKey(_circuit: CircuitName): Promise<Uint8Array> {
    return new Uint8Array(1_760);
  }

  async destroy(): Promise<void> {}
}

const PUBLIC: Partial<Record<CircuitName, readonly string[]>> = {
  bid_validity: BID_VALIDITY_PUBLIC_INPUTS,
  winner_allocation: WINNER_ALLOCATION_PUBLIC_INPUTS,
  settlement_binding: SETTLEMENT_BINDING_PUBLIC_INPUTS,
};

function publicInputsOf(circuit: CircuitName, inputs: NoirInputs): string[] {
  return (PUBLIC[circuit] ?? []).map((name) => {
    const m = /^(.*)\[(\d+)\]$/.exec(name);
    const v = m === null ? inputs[name] : (inputs[m[1]!] as string[] | undefined)?.[Number(m[2])];
    if (typeof v !== "string") throw new Error(`FakeProver: input ${name} ausente em ${circuit}`);
    return `0x${BigInt(v).toString(16).padStart(64, "0")}`;
  });
}
