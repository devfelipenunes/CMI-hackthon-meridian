

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { specEntriesFromWasm } from "@zolvency-cmi/core";

function render(name: string, wasmPath: string): string {
  const wasm = readFileSync(wasmPath);
  const upper = name.toUpperCase();
  const entries = specEntriesFromWasm(wasm).map((e) => `  "${e}",`).join("\n");
  return [
    `// GERADO por scripts/gen-bindings.sh a partir de ${basename(wasmPath)}. Não editar à mão (S-07).`,
    `export const ${upper}_WASM_SHA256 = "${createHash("sha256").update(wasm).digest("hex")}";`,
    "",
    `/** Spec do contrato (\`contractspecv0\`), entradas em XDR base64. */`,
    `export const ${upper}_SPEC: readonly string[] = [`,
    entries,
    "];",
    "",
  ].join("\n");
}

const [auction, factory, out] = process.argv.slice(2);
if (auction === undefined || factory === undefined || out === undefined) {
  process.stderr.write("uso: gen-bindings.ts <auction.wasm> <factory.wasm> <saída>\n");
  process.exit(2);
}
writeFileSync(join(out, "auction.ts"), render("auction", auction));
writeFileSync(join(out, "factory.ts"), render("factory", factory));
process.stdout.write(`ok: ${join(out, "auction.ts")}, ${join(out, "factory.ts")}\n`);
