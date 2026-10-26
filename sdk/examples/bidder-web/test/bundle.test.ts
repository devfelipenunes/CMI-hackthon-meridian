import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import { BUNDLE_BUDGET } from "../bundle-budget.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

/**
 * Passo 6.2: o build de produção do `bidder-web`. O plugin `module-report` do vite.config grava
 * em `dist/modules.json` todo módulo que entrou no bundle; o tamanho é medido nos arquivos do `dist/`.
 */
describe("bundle do client no navegador (passo 6.2)", () => {
  let modules: string[] = [];

  beforeAll(async () => {
    await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "silent" });
    modules = JSON.parse(readFileSync(join(DIST, "modules.json"), "utf8")) as string[];
  }, 600_000);

  it("client bundle contains no operator code", () => {
    expect(modules.some((m) => m.includes("/packages/client/"))).toBe(true);
    expect(modules.filter((m) => m.includes("/packages/operator/"))).toEqual([]);
    expect(modules.filter((m) => m.includes("/packages/testing/"))).toEqual([]);
  });

  it("client bundle size below S-14 budget", () => {
    const files = readdirSync(join(DIST, "assets")).map((f) => ({ f, size: statSync(join(DIST, "assets", f)).size }));
    // O app e o SDK (o que carrega ao abrir a tela) e, à parte, o prover (bb.js + noir, carregado sob demanda).
    const app = files.filter((x) => x.f.endsWith(".js") && !/bb|barretenberg|noir|acvm|abi|worker/i.test(x.f)).reduce((s, x) => s + x.size, 0);
    const total = files.reduce((s, x) => s + x.size, 0);
    expect(app).toBeLessThanOrEqual(BUNDLE_BUDGET.appJsBytes);
    expect(total).toBeLessThanOrEqual(BUNDLE_BUDGET.totalBytes);
  });
});
