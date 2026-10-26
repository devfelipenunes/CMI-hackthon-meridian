#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = [
  { name: "artifacts", entries: ["index", "node"] },
  { name: "core", entries: ["index"], bundle: ["@ctd/sdk"] },
  { name: "client", entries: ["index"] },
  { name: "operator", entries: ["index"] },
];

for (const p of PACKAGES) {
  const dir = join(ROOT, "packages", p.name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  const inside = new Set(p.bundle ?? []);
  const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})].filter((d) => !inside.has(d));
  await build({
    entryPoints: p.entries.map((e) => join(dir, "src", `${e}.ts`)),
    outdir: join(dir, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    external: [...external, "node:*"],
    legalComments: "inline",
    logLevel: "warning",
  });

  const paths = { "@zolvency-cmi/artifacts": ["../artifacts/dist/index.d.ts"], "@zolvency-cmi/artifacts/node": ["../artifacts/dist/node.d.ts"], "@zolvency-cmi/core": ["../core/dist/index.d.ts"] };
  const tsconfig = join(dir, "tsconfig.build.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, stripInternal: true, outDir: "dist", rootDir: "src", paths },
      include: ["src"],
    }),
  );
  try {
    execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", tsconfig], { stdio: "inherit" });
  } finally {
    rmSync(tsconfig);
  }
  process.stdout.write(`ok: @zolvency-cmi/${p.name} → dist/\n`);
}
