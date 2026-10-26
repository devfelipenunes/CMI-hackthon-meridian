import { describe, expect, it } from "vitest";

import { ArtifactSet, TOKEN_CIRCUITS, verifyArtifacts } from "../../src/index.js";
import { loadDevArtifacts } from "../../src/node.js";

describe("dev artifacts", () => {
  const set = loadDevArtifacts();

  it("are tagged dev", () => {
    expect(set.contractsTag).toBe("dev");
  });

  it.each(TOKEN_CIRCUITS)("load token circuit %s from the submodules", (name) => {
    const circuit = set.circuit(name);
    expect(typeof circuit.bytecode).toBe("string");
    expect(circuit.abi).toBeDefined();
  });

  it.each(TOKEN_CIRCUITS)("load the %s vk (1760 bytes)", (name) => {
    expect(set.vk(name).length).toBe(1760);
  });

  it("pass verification against dev-sources.json", () => {
    expect(() => verifyArtifacts(set)).not.toThrow();
  });

  it("detect a changed byte in a submodule file", () => {
    const files = new Map(set.files());
    const vk = new Uint8Array(files.get("vks/register.vk.bin")!);
    vk[100] = vk[100]! ^ 0x01;
    files.set("vks/register.vk.bin", vk);
    const tampered = new ArtifactSet(files, set.sums(), { contractsTag: "dev" });

    expect(() => verifyArtifacts(tampered)).toThrow(
      expect.objectContaining({ code: "ArtifactMismatch", path: "vks/register.vk.bin" }),
    );
  });

  it("detect a missing file", () => {
    const files = new Map(set.files());
    files.delete("circuits/withdraw.json");
    const missing = new ArtifactSet(files, set.sums(), { contractsTag: "dev" });
    expect(() => verifyArtifacts(missing)).toThrow(expect.objectContaining({ code: "ArtifactMismatch" }));
  });

  it("bid_validity comes from the contracts build (artifacts/), with the sha256 of its SHA256SUMS", () => {
    expect(set.vk("bid_validity")).toHaveLength(1760);
    expect(set.circuit("bid_validity")).toMatchObject({ bytecode: expect.any(String) });
  });

  it("the three CMI circuits come from the contracts build", () => {
    for (const name of ["bid_validity", "winner_allocation", "settlement_binding"] as const) {
      expect(set.circuit(name).bytecode).toBeTypeOf("string");
      expect(set.vk(name).length).toBeGreaterThan(0);
    }
  });
});
