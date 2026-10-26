import type { UltraHonkBackendCtor } from "../node/bb-loader.js";

export function browserBackendLoader(moduleUrl?: string): () => Promise<UltraHonkBackendCtor> {
  return async () => {
    const mod = moduleUrl ? await import(/* @vite-ignore */ moduleUrl) : await import("@aztec/bb.js");
    return mod.UltraHonkBackend as UltraHonkBackendCtor;
  };
}
