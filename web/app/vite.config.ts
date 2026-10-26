import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DEV_WALLET = process.env["VITE_DEV_WALLET"] === "1";

const SDK_STORE = fileURLToPath(new URL("../../sdk/node_modules/.pnpm", import.meta.url));
const SDK_SHARED = [
  "@aztec/bb.js",
  "@noir-lang/acvm_js",
  "@noir-lang/noir_js",
  "@noir-lang/noirc_abi",
  "@noble/curves",
  "@noble/hashes",
  "@stellar/stellar-sdk",
  "@zkpassport/poseidon2",
  "pako",
] as const;

function sdkCopy(name: string): string {
  const flat = name.replace("/", "+");
  const dir = readdirSync(SDK_STORE).find((entry) => entry === flat || entry.startsWith(`${flat}@`));
  if (dir === undefined) {
    throw new Error(`${name} não está em ${SDK_STORE}; rode \`pnpm install\` em sdk/ antes do build`);
  }
  return join(SDK_STORE, dir, "node_modules", name);
}

const sharedAliases = Object.fromEntries(SDK_SHARED.map((name) => [name, sdkCopy(name)]));

const CIRCUITS = ["register", "set_spender", "bid_validity", "revoke_spender"] as const;

function artifacts(): Plugin {
  return {
    name: "cmi-artifacts",
    apply: "build",
    generateBundle() {
      const dev = JSON.parse(readFileSync(join(REPO, "sdk/packages/artifacts/dev-sources.json"), "utf8")) as {
        files: Record<string, { from: string; sha256: string }>;
      };
      const lines: string[] = [];
      for (const name of CIRCUITS) {
        for (const path of [`circuits/${name}.json`, `vks/${name}.vk.bin`]) {
          const src = dev.files[path];
          if (src === undefined) throw new Error(`sem ${path} no dev-sources.json`);
          const bytes = readFileSync(join(REPO, "sdk", src.from));
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

function moduleReport(): Plugin {
  return {
    name: "cmi-module-report",
    apply: "build",
    generateBundle(_opts, bundle) {
      const ids = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") for (const id of Object.keys(chunk.modules)) ids.add(id);
      }
      this.emitFile({ type: "asset", fileName: "modules.json", source: JSON.stringify([...ids].sort(), null, 2) });
    },
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",

  "font-src 'self' data:",
  "img-src 'self' data:",

  "connect-src 'self' data: https://crs.aztec.network https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org https://friendbot.stellar.org",
  "base-uri 'none'",
  "form-action 'self'",

].join("; ");

function csp(): Plugin {
  return {
    name: "cmi-csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

const isolation =
  process.env["CMI_COOP_COEP"] === "1"
    ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }
    : {};

export default defineConfig({
  plugins: [react(), artifacts(), moduleReport(), csp()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), ...sharedAliases },
  },

  optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"] },
  build: { target: "es2022", chunkSizeWarningLimit: 25_000 },
  worker: { format: "es" },
  server: { headers: isolation },
  preview: { headers: isolation },
  define: { __DEV_WALLET_BUILD__: JSON.stringify(DEV_WALLET) },
});
