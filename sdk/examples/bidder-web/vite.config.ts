import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** Os circuitos que o bidder prova no navegador (e o `revoke_spender`, da recuperação). */
const CIRCUITS = ["register", "set_spender", "bid_validity", "revoke_spender"];

/**
 * Copia os circuitos e VKs para `dist/artifacts/`, com um `SHA256SUMS`. A fonte é a dos artefatos
 * de desenvolvimento (`dev-sources.json`, conferidos pelo sha256 de lá); num deploy de verdade,
 * a release instalada por `scripts/fetch-artifacts.sh` (S-06).
 */
function artifacts(): Plugin {
  return {
    name: "cmi-artifacts",
    generateBundle() {
      const dev = JSON.parse(readFileSync(join(REPO, "packages/artifacts/dev-sources.json"), "utf8")) as { files: Record<string, { from: string; sha256: string }> };
      const lines: string[] = [];
      for (const name of CIRCUITS) {
        for (const path of [`circuits/${name}.json`, `vks/${name}.vk.bin`]) {
          const src = dev.files[path];
          if (src === undefined) throw new Error(`sem ${path} no dev-sources.json`);
          const bytes = readFileSync(join(REPO, src.from));
          const sum = createHash("sha256").update(bytes).digest("hex");
          if (sum !== src.sha256) throw new Error(`${path}: sha256 ${sum}, esperado ${src.sha256}`);
          this.emitFile({ type: "asset", fileName: `artifacts/${path}`, source: bytes });
          lines.push(`${sum}  ${path}`);
        }
      }
      this.emitFile({ type: "asset", fileName: "artifacts/SHA256SUMS", source: `${lines.join("\n")}\n` });
    },
  };
}

/** Grava em `dist/modules.json` todo módulo que entrou no bundle (o teste de bundle do 6.2 o lê). */
function moduleReport(): Plugin {
  return {
    name: "cmi-module-report",
    generateBundle(_opts, bundle) {
      const ids = new Set<string>();
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") for (const id of Object.keys(chunk.modules)) ids.add(id);
      this.emitFile({ type: "asset", fileName: "modules.json", source: JSON.stringify([...ids].sort(), null, 2) });
    },
  };
}

// COOP/COEP liberam as threads do bb.js (S-14); são opcionais: sem eles a prova roda em uma thread.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  plugins: [artifacts(), moduleReport()],
  // S-14: bb.js e noir fora do pre-bundle (worker e wasm).
  optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"] },
  build: { target: "es2022", chunkSizeWarningLimit: 20_000 },
  worker: { format: "es" },
  server: { headers: isolation },
  preview: { headers: isolation },
});
