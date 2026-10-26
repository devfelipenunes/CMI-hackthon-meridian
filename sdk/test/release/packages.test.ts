import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGES = ["artifacts", "core", "client", "operator"] as const;
type Pkg = (typeof PACKAGES)[number];

interface Packed {
  files: string[];
  manifest: {
    name: string;
    version: string;
    license?: string;
    exports: Record<string, { types: string; import: string }>;
    dependencies?: Record<string, string>;
    publishConfig?: { access?: string; provenance?: boolean };
  };
  read(path: string): string;
}

const packed = new Map<Pkg, Packed>();

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: REPO, stdio: "pipe" });
  for (const p of PACKAGES) {
    const out = mkdtempSync(join(tmpdir(), `cmi-pack-${p}-`));
    execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: join(REPO, "packages", p), stdio: "pipe" });
    const tgz = join(out, readdirSync(out).find((f) => f.endsWith(".tgz"))!);
    execFileSync("tar", ["-xzf", tgz, "-C", out]);
    const files = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split("\n").map((f) => f.replace(/^package\//, ""));
    const read = (path: string): string => readFileSync(join(out, "package", path), "utf8");
    packed.set(p, { files, manifest: JSON.parse(read("package.json")) as Packed["manifest"], read });
  }
}, 600_000);

describe("pacotes da release 0.1.0 (passo 6.5)", () => {
  it.each(PACKAGES)("%s: the tarball has dist, README and CHANGELOG, and no source or tests", (p) => {
    const { files } = packed.get(p)!;
    expect(files).toEqual(expect.arrayContaining(["package.json", "README.md", "CHANGELOG.md"]));
    expect(files.some((f) => f.startsWith("dist/") && f.endsWith(".js"))).toBe(true);
    expect(files.filter((f) => f.startsWith("src/") || f.startsWith("test/") || f.endsWith(".ts") && !f.endsWith(".d.ts"))).toEqual([]);
  });

  it.each(PACKAGES)("%s: version 0.1.0, exports to built JS and types, no workspace ranges, npm provenance", (p) => {
    const { manifest, files } = packed.get(p)!;
    expect(manifest.name).toBe(`@zolvency-cmi/${p}`);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.publishConfig).toMatchObject({ access: "public", provenance: true });
    for (const target of Object.values(manifest.exports)) {
      expect(files).toContain(target.import.replace(/^\.\//, ""));
      expect(files).toContain(target.types.replace(/^\.\//, ""));
    }
    expect(JSON.stringify(manifest.dependencies ?? {})).not.toContain("workspace:");
  });

  it("core embeds @ctd/sdk: no dependency, no import of it in JS or types, and a third-party notice", () => {
    const core = packed.get("core")!;
    expect(Object.keys(core.manifest.dependencies ?? {})).not.toContain("@ctd/sdk");
    for (const f of core.files.filter((x) => x.startsWith("dist/"))) expect(core.read(f)).not.toMatch(/from\s*["']@ctd\/sdk/);
    expect(core.files).toContain("THIRD_PARTY_NOTICES.md");
    expect(core.read("THIRD_PARTY_NOTICES.md")).toContain("stellar-confidential-token-demo");
  });

  it("the client package carries no operator code", () => {
    const client = packed.get("client")!;
    for (const f of client.files.filter((x) => x.startsWith("dist/") && x.endsWith(".js"))) {
      expect(client.read(f)).not.toMatch(/@zolvency-cmi\/operator|CmiOperator|planAllocation/);
    }
  });

  it("the built entry points load and expose the public API", async () => {
    const load = (p: string, file: string) => import(join(REPO, "packages", p, "dist", file)) as Promise<Record<string, unknown>>;
    expect(Object.keys(await load("artifacts", "index.js"))).toEqual(expect.arrayContaining(["ArtifactSet", "SUPPORTED_CONTRACTS_TAGS"]));
    expect(Object.keys(await load("artifacts", "node.js"))).toEqual(expect.arrayContaining(["loadArtifacts"]));
    expect(Object.keys(await load("core", "index.js"))).toEqual(expect.arrayContaining(["createProver", "bidCommitment", "chainAuctionPort", "marketVersion"]));
    expect(Object.keys(await load("client", "index.js"))).toEqual(expect.arrayContaining(["connectClient", "MarketsApi", "BrowserKeyProvider"]));
    expect(Object.keys(await load("operator", "index.js"))).toEqual(expect.arrayContaining(["CmiOperator", "Keeper", "planNextAction"]));
  });
});
