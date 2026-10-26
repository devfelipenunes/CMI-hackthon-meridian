import { sponge } from "@ctd/sdk";

import { toField, type Field } from "../field/field.js";

export function poseidon2Hash(inputs: readonly Field[]): Field {
  if (inputs.length === 0) throw new RangeError("poseidon2Hash needs at least one input");
  return sponge(inputs.map(toField));
}
