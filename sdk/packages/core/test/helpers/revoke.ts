import { Secret, buildRevokeSpenderWitness, buildSetSpenderWitness } from "../../src/index.js";
import { fixture } from "./token-fixture.js";

export function revokeScenario() {
  const f = fixture();
  const setSpender = buildSetSpenderWitness(f.params, f.rng);
  const d = setSpender.delegation.expose();
  const revoke = buildRevokeSpenderWitness(
    {
      keys: f.bidder,
      spend: setSpender.next,
      opI: f.params.opI,
      allowance: new Secret({ vA: d.vA, sigmaA: d.sigmaA }),
      kAudS: f.params.kAudS,
    },
    f.rng,
  );
  return { f, setSpender, revoke };
}
