
export const VERSION = "0.1.0";

export const SUPPORTED_CONTRACTS_TAGS: readonly string[] = Object.freeze(["v0.1.0"]);

export { ArtifactError } from "./errors.js";
export { parseSha256Sums } from "./sums.js";
export {
  ArtifactSet,
  CMI_CIRCUITS,
  TOKEN_CIRCUITS,
  verifyArtifacts,
  type CircuitName,
  type CmiCircuitName,
  type CompiledCircuit,
  type TokenCircuitName,
} from "./set.js";
