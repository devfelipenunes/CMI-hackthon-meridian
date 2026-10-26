import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadArtifacts } from "../../src/node.js";
import { TOKEN_CIRCUITS, type TokenCircuitName } from "../../src/set.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const DEV = JSON.parse(readFileSync(join(REPO, "packages/artifacts/dev-sources.json"), "utf8")) as { files: Record<string, { from: string }> };
const pinned = (path: string): Buffer => readFileSync(join(REPO, DEV.files[path]!.from));
const pinnedVk = (n: TokenCircuitName): Buffer => pinned(`vks/${n}.vk.bin`);
const pinnedCircuit = (n: TokenCircuitName): { bytecode: string } => JSON.parse(pinned(`circuits/${n}.json`).toString("utf8")) as { bytecode: string };

function fakeInstalledRelease(tag: string, corrupt = false, opts: { tokenVks?: "pinned" | "other" } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "artifacts-root-"));
  const dir = join(root, "releases", tag);
  mkdirSync(join(dir, "circuits"), { recursive: true });
  mkdirSync(join(dir, "vks"));
  const files: Record<string, Buffer> =
    opts.tokenVks === undefined
      ? {
          "circuits/bid_validity.json": Buffer.from(JSON.stringify({ bytecode: "H4sI", abi: {} })),
          "vks/bid_validity.vk.bin": Buffer.alloc(1760, 7),
          "circuits/set_spender.json": Buffer.from(JSON.stringify({ bytecode: "H4sJ", abi: {} })),
          "vks/set_spender.vk.bin": Buffer.alloc(1760, 9),
        }
      : {
          "circuits/bid_validity.json": Buffer.from(JSON.stringify({ bytecode: "H4sI", abi: {} })),
          "vks/bid_validity.vk.bin": Buffer.alloc(1760, 7),
          ...Object.fromEntries(TOKEN_CIRCUITS.map((n) => [`vks/${n}.vk.bin`, opts.tokenVks === "pinned" ? pinnedVk(n) : Buffer.alloc(1760, 3)])),
        };
  const lines = Object.entries(files).map(([path, bytes]) => {
    writeFileSync(join(dir, path), bytes);
    const sum = createHash("sha256").update(corrupt ? Buffer.from("x") : bytes).digest("hex");
    return `${sum}  ${path}`;
  });
  writeFileSync(join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`);
  return root;
}

describe("release artifacts", () => {
  it("load CMI and token circuits from one flat release tree", () => {
    const set = loadArtifacts({ release: "v0.1.0-rc.1", root: fakeInstalledRelease("v0.1.0-rc.1") });
    expect(set.contractsTag).toBe("v0.1.0-rc.1");
    expect(set.circuit("bid_validity").bytecode).toBe("H4sI");
    expect(set.circuit("set_spender").bytecode).toBe("H4sJ");
    expect(set.vk("bid_validity").length).toBe(1760);
  });

  it("refuse a release whose files do not match SHA256SUMS", () => {
    expect(() => loadArtifacts({ release: "v0.1.0-rc.1", root: fakeInstalledRelease("v0.1.0-rc.1", true) })).toThrow(
      expect.objectContaining({ code: "ArtifactMismatch" }),
    );
  });

  it("a release with only the token VKs takes the token circuits from the pinned submodules", () => {
    const root = fakeInstalledRelease("v0.1.0-rc.1", false, { tokenVks: "pinned" });
    const set = loadArtifacts({ release: "v0.1.0-rc.1", root });
    expect(set.contractsTag).toBe("v0.1.0-rc.1");
    expect(set.circuit("bid_validity").bytecode).toBe("H4sI");
    for (const name of TOKEN_CIRCUITS) {
      expect(set.circuit(name).bytecode).toBe(pinnedCircuit(name).bytecode);
      expect(Buffer.from(set.vk(name)).equals(pinnedVk(name))).toBe(true);
    }
  });

  it("refuse a release whose token VK is not the one of the pinned token circuit", () => {
    const root = fakeInstalledRelease("v0.1.0-rc.1", false, { tokenVks: "other" });
    expect(() => loadArtifacts({ release: "v0.1.0-rc.1", root })).toThrow(expect.objectContaining({ code: "ArtifactMismatch", path: "vks/register.vk.bin" }));
  });
});
