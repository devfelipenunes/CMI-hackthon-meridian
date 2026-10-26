#!/usr/bin/env tsx
/**
 * Passo 1.2 (F-03): grava o `register_data` do operador em app/public/config/testnet.json.
 *
 * Precedência:
 *   1. CMI_REGISTER_DATA (base64) — o dado exportado pelo sistema do operador;
 *   2. CMI_OPERATOR_SPENDER_KEY (hex do sk_op) — o script gera a prova;
 *   3. nenhuma das duas — gera um sk_op de desenvolvimento e o grava no .env.local (0600).
 *
 * O `sk_op` nunca é impresso nem entra em app/. O que o app recebe é o dado público e o
 * `operatorKeyId` (sha256 do ponto Y), usado para marcar mercados de outra chave.
 */
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import {
  FR_MODULUS,
  Secret,
  addressToField,
  createProver,
  cryptoRng,
  deriveTokenKeys,
  pointToBytes,
  type Scalar,
} from "@zolvency-cmi/core";
import { buildRegisterData } from "@zolvency-cmi/operator";

import { UsageError, done, fail, parseArgs, step, warn } from "./lib/cli.js";
import { readConfig, writeOperatorConfig } from "./lib/config.js";
import { loadEnvLocalIntoProcess, writeEnvLocalKey } from "./lib/env.js";
import { appConfigPath } from "./lib/paths.js";
import { decodeBase64RegisterData, decodeRegisterData, operatorKeyIdFromY } from "./lib/register-data.js";
import { simulateCreateMarket } from "./lib/simulate.js";

const USAGE = `uso: pnpm register-data [--force] [--no-verify]

  --force      regenera a prova mesmo se a config já tiver a mesma chave
  --no-verify  não simula create_market na testnet (só para trabalho offline)

Fontes, nesta ordem: CMI_REGISTER_DATA, CMI_OPERATOR_SPENDER_KEY, chave dev no .env.local.`;

const SPENDER_KEY_ENV = "CMI_OPERATOR_SPENDER_KEY";

function parseSpenderKey(hex: string): Scalar {
  const clean = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) fail(`${SPENDER_KEY_ENV} deve ter 32 bytes em hex (64 dígitos)`);
  const value = BigInt(`0x${clean}`);
  if (value === 0n || value >= FR_MODULUS) fail(`${SPENDER_KEY_ENV} não é um escalar válido`);
  return value as Scalar;
}

function keyIdFor(spenderKey: Scalar, token: string): string {
  const keys = deriveTokenKeys(spenderKey, addressToField(token));
  return operatorKeyIdFromY(pointToBytes(keys.Y));
}

interface Source {
  kind: "CMI_REGISTER_DATA" | "CMI_OPERATOR_SPENDER_KEY" | "chave de desenvolvimento";
  operatorKeyId: string;
  spenderKey: Scalar | null;
  registerData: Uint8Array | null;
}

function readSource(configToken: string): Source {
  const data = (process.env.CMI_REGISTER_DATA ?? "").trim();
  if (data.length > 0) {
    const registerData = decodeBase64RegisterData(data);
    const { operatorKeyId } = decodeRegisterData(registerData);
    return { kind: "CMI_REGISTER_DATA", operatorKeyId, spenderKey: null, registerData };
  }

  const key = (process.env[SPENDER_KEY_ENV] ?? "").trim();
  if (key.length > 0) {
    const spenderKey = parseSpenderKey(key);
    return {
      kind: "CMI_OPERATOR_SPENDER_KEY",
      operatorKeyId: keyIdFor(spenderKey, configToken),
      spenderKey,
      registerData: null,
    };
  }

  const spenderKey = cryptoRng.scalar() as Scalar;
  const hex = spenderKey.toString(16).padStart(64, "0");
  writeEnvLocalKey(SPENDER_KEY_ENV, hex);
  process.env[SPENDER_KEY_ENV] = hex;
  warn(`chave de desenvolvimento gerada e gravada em .env.local (0600). O valor não será impresso.`);
  warn("troque por CMI_OPERATOR_SPENDER_KEY da operação antes de usar fora da testnet.");
  return {
    kind: "chave de desenvolvimento",
    operatorKeyId: keyIdFor(spenderKey, configToken),
    spenderKey,
    registerData: null,
  };
}

async function prove(source: Source, configToken: string): Promise<Uint8Array> {
  if (source.spenderKey === null) fail("fonte sem chave para provar");
  step("carregando circuitos e VKs (dev-sources.json)");
  const artifacts = loadDevArtifacts();
  const prover = createProver({ artifacts });
  try {
    step("gerando a prova de register (alguns segundos)");
    const data = await buildRegisterData({
      spenderKey: new Secret(source.spenderKey),
      tokenAddress: configToken,
      prover,
    });
    const decoded = decodeRegisterData(data);
    if (decoded.operatorKeyId !== source.operatorKeyId) {
      fail("o register_data gerado não corresponde à chave; nada foi gravado");
    }
    return data;
  } finally {
    await prover.destroy();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), []);
  if (args.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  if (args.positional.length > 0) throw new UsageError(`argumento inesperado: ${args.positional[0]}`);
  for (const flag of args.flags) {
    if (flag !== "force" && flag !== "no-verify") throw new UsageError(`opção desconhecida: --${flag}`);
  }

  loadEnvLocalIntoProcess();

  const config = readConfig();
  if (config === null) fail("config ausente ou inválida: rode `pnpm sync:deployment` primeiro");

  const source = readSource(config.contracts.token);
  step(`fonte: ${source.kind}`);
  step(`operatorKeyId: ${source.operatorKeyId}`);

  let registerData = source.registerData;
  const unchanged = config.operatorKeyId === source.operatorKeyId && config.registerData !== null;
  if (registerData === null && unchanged && !args.flags.has("force")) {
    registerData = decodeBase64RegisterData(config.registerData!);
    step("a config já tem uma prova desta chave; reaproveitando (use --force para refazer)");
  }
  if (registerData === null) {
    registerData = await prove(source, config.contracts.token);
  }

  if (!args.flags.has("no-verify")) {
    await simulateCreateMarket(config, registerData);
  } else {
    warn("simulação de create_market pulada (--no-verify)");
  }

  const base64 = Buffer.from(registerData).toString("base64");
  if (config.registerData === base64 && config.operatorKeyId === source.operatorKeyId) {
    done(`config já estava atualizada em ${appConfigPath}`);
    return;
  }

  writeOperatorConfig(base64, source.operatorKeyId);
  done(`register_data gravado em ${appConfigPath}`);
  console.log(`  próxima etapa: reinicie o dev server para o app reler a config`);
}

main().catch((error: unknown) => {
  console.error(`erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
