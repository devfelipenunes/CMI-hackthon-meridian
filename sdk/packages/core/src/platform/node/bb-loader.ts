import type { UltraHonkBackend } from "@aztec/bb.js";

export type UltraHonkBackendCtor = new (bytecode: string, options?: { threads?: number }) => UltraHonkBackend;

export async function defaultBackendLoader(): Promise<UltraHonkBackendCtor> {
  return (await import("@aztec/bb.js")).UltraHonkBackend as unknown as UltraHonkBackendCtor;
}
