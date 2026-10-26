import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ArtifactError } from "./errors.js";
import { ArtifactSet, TOKEN_CIRCUITS, verifyArtifacts } from "./set.js";
import { parseSha256Sums } from "./sums.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export function loadArtifacts(opts: { release: string; root?: string; repoRoot?: string }): ArtifactSet {
  const dir = join(opts.root ?? PACKAGE_ROOT, "releases", opts.release);
  const files = new Map<string, Uint8Array>();
  const sums = parseSha256Sums(readFileSync(join(dir, "SHA256SUMS"), "utf8"));
  for (const path of sums.keys()) files.set(path, new Uint8Array(readFileSync(join(dir, path))));

  const missing = TOKEN_CIRCUITS.filter((n) => !sums.has(`circuits/${n}.json`) && sums.has(`vks/${n}.vk.bin`));
  if (missing.length > 0) {
    const manifest = readDevSources();
    for (const name of missing) {
      const vk = `vks/${name}.vk.bin`;
      if (sums.get(vk) !== manifest.files[vk]?.sha256) {
        throw new ArtifactError("ArtifactMismatch", vk, `a VK da release ${opts.release} não é a do circuito fixado em dev-sources.json`);
      }
      const circuit = `circuits/${name}.json`;
      const src = manifest.files[circuit]!;
      files.set(circuit, new Uint8Array(readFileSync(join(opts.repoRoot ?? REPO_ROOT, src.from))));
      sums.set(circuit, src.sha256);
    }
  }
  const set = new ArtifactSet(files, sums, { contractsTag: opts.release });
  verifyArtifacts(set);
  return set;
}

interface DevSources {
  files: Record<string, { from: string; sha256: string }>;
}

function readDevSources(): DevSources {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "dev-sources.json"), "utf8")) as DevSources;
}

export function loadDevArtifacts(opts: { repoRoot?: string } = {}): ArtifactSet {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const manifest = readDevSources();
  const files = new Map<string, Uint8Array>();
  const sums = new Map<string, string>();
  for (const [path, { from, sha256 }] of Object.entries(manifest.files)) {
    files.set(path, new Uint8Array(readFileSync(join(repoRoot, from))));
    sums.set(path, sha256);
  }
  const set = new ArtifactSet(files, sums, { contractsTag: "dev" });
  verifyArtifacts(set);
  return set;
}
