import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { dotEnvExamplePath, envLocalPath } from "./paths.js";

/** `.env.local` é lido só aqui, pelos scripts. O Vite só expõe `VITE_*` ao app. */
const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && last === first) return trimmed.slice(1, -1);
  }
  // Comentário no fim da linha (`VALOR # nota`), sem mexer em `#` dentro de aspas.
  const hash = value.indexOf(" #");
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = LINE.exec(trimmed);
    if (match !== null) out.set(match[1]!, unquote(match[2]!));
  }
  return out;
}

export function readEnvLocal(path = envLocalPath): Map<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : new Map();
}

/**
 * Carrega o `.env.local` em `process.env` sem sobrescrever o que já veio do shell: uma variável
 * exportada na linha de comando tem precedência sobre o arquivo.
 */
export function loadEnvLocalIntoProcess(path = envLocalPath): void {
  for (const [key, value] of readEnvLocal(path)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Troca `KEY=...` mantendo o resto do arquivo; acrescenta no fim se a chave não existir. */
export function upsertEnv(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1] !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    while (next.length > 0 && next[next.length - 1] === "") next.pop();
    next.push(`${key}=${value}`, "");
  }
  return next.join("\n");
}

/**
 * Grava a chave de desenvolvimento uma vez. O arquivo nasce (e continua) com permissão 0600:
 * é o único lugar do repositório onde `sk_op` existe.
 */
export function writeEnvLocalKey(key: string, value: string, path = envLocalPath): void {
  const current = existsSync(path) ? readFileSync(path, "utf8") : makeSeed();
  writeFileSync(path, upsertEnv(current, key, value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function makeSeed(): string {
  if (!existsSync(dotEnvExamplePath)) return "";
  // O arquivo novo herda os comentários do .env.example, menos os valores vazios.
  return readFileSync(dotEnvExamplePath, "utf8");
}
