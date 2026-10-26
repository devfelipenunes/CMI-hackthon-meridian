import { addressToField as ctdAddressToField } from "@ctd/sdk";

import type { Field } from "../field/field.js";

export function addressToField(address: string): Field {
  if (!/^[GC][A-Z2-7]{55}$/.test(address)) throw new RangeError("expected a 56-char G… or C… strkey");
  return ctdAddressToField(address);
}
