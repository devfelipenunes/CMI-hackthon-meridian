import { readFileSync } from "node:fs";

import { TOKEN_CIRCUITS } from "@zolvency-cmi/artifacts";
import {
  ChainClient,
  chainFactoryPort,
  chainTokenPort,
  contractsVersionOf,
  pointToBytes,
  type PlatformConfig,
} from "@zolvency-cmi/core";

import { fail, step } from "./cli.js";
import type { Deployment } from "./deployment.js";
import { devSourcesPath } from "./paths.js";

const CONTRACT = /^C[A-Z2-7]{55}$/;

export interface VerifiedDeployment {
  chain: ChainClient;
  platform: PlatformConfig;
  nextMarketId: bigint;
  latestLedger: number;
}

interface DevSources {
  files: Record<string, { from: string; sha256: string }>;
}

function expectEqual(what: string, actual: string | number | bigint, expected: string | number | bigint): void {
  if (actual !== expected) fail(`${what} diverge: rede=${String(actual)} deployment=${String(expected)}`);
}

function readDevSources(): DevSources {
  try {
    return JSON.parse(readFileSync(devSourcesPath, "utf8")) as DevSources;
  } catch {
    return fail(`não consegui ler ${devSourcesPath}; os submódulos do SDK estão completos?`);
  }
}

/**
 * Confere o deployment contra a rede e contra os artefatos fixados pelo SDK (F-06):
 * - o WASM da Auction é uma versão que este SDK sabe provar (bindings, S-18);
 * - Factory, token, auditor e verifier são os WASMs que o deployment diz que são;
 * - as VKs do token são as de `dev-sources.json` (o navegador prova com elas);
 * - a PlatformConfig da Factory bate campo a campo com o deployment.
 * Nada é enviado; só `simulate`/leitura.
 */
export async function verifyDeployment(dep: Deployment): Promise<VerifiedDeployment> {
  // O limite de versão é local: falha antes de qualquer chamada de rede.
  try {
    contractsVersionOf(dep.auction_wasm_hash);
  } catch {
    fail(
      `o auction_wasm_hash ${dep.auction_wasm_hash} não é de uma versão suportada pelo SDK neste checkout. ` +
        "Atualize o SDK antes de configurar o app.",
    );
  }
  if (dep.wasm_sha256.auction !== undefined && dep.wasm_sha256.auction !== dep.auction_wasm_hash) {
    fail("wasm_sha256.auction diverge de auction_wasm_hash no deployment");
  }

  const expectedVks = new Set<string>(TOKEN_CIRCUITS);
  const declared = new Set(Object.keys(dep.token_vks));
  if (declared.size !== expectedVks.size || [...expectedVks].some((name) => !declared.has(name))) {
    fail(`token_vks do deployment não cobre exatamente os circuitos do token (${[...expectedVks].join(", ")})`);
  }

  const sources = readDevSources();
  for (const name of TOKEN_CIRCUITS) {
    const file = `vks/${name}.vk.bin`;
    const pinned = sources.files[file]?.sha256;
    if (pinned === undefined) fail(`dev-sources.json não fixa ${file}`);
    expectEqual(`VK ${name} (dev-sources × deployment)`, dep.token_vks[name]!, pinned);
  }
  step(`VKs do token conferem com dev-sources.json (${TOKEN_CIRCUITS.length} circuitos)`);

  const chain = new ChainClient({ rpcUrl: dep.rpc_url, networkPassphrase: dep.passphrase });
  step(`RPC ${dep.rpc_url}`);

  const wasmChecks: [string, string, string | undefined][] = [
    ["Factory", dep.contracts.factory, dep.wasm_sha256.factory],
    ["Confidential Token", dep.contracts.token, dep.wasm_sha256.confidential_token],
    ["Auditor", dep.contracts.auditor, dep.wasm_sha256.confidential_auditor],
    ["Verifier", dep.contracts.verifier, dep.wasm_sha256.confidential_verifier],
  ];
  for (const [label, address, expected] of wasmChecks) {
    const actual = await chain.contractWasmHash(address);
    if (expected !== undefined) expectEqual(`WASM da ${label}`, actual, expected);
  }
  step("WASMs implantados conferem com o deployment");

  const factory = chainFactoryPort({ chain, address: dep.contracts.factory });
  const [platform, nextMarketId, latestLedger] = await Promise.all([
    factory.getPlatformConfig(),
    factory.nextMarketId(),
    chain.latestLedger(),
  ]);

  const platformChecks: [string, string | number, string | number][] = [
    ["platform.collateral_token", platform.collateralToken, dep.contracts.token],
    ["platform.fee_asset", platform.feeAsset, dep.contracts.underlying],
    ["platform.bid_verifier", platform.bidVerifier, dep.contracts.bid_verifier],
    ["platform.allocation_verifier", platform.allocationVerifier, dep.contracts.allocation_verifier],
    ["platform.settlement_verifier", platform.settlementVerifier, dep.contracts.settlement_verifier],
    ["platform.fee_wallet", platform.feeWallet, dep.fee_wallet],
    ["platform.auditor_id", platform.auditorId, dep.auditor.id],
    ["platform.finalization_grace_ledgers", platform.finalizationGraceLedgers, dep.finalization_grace_ledgers],
  ];
  for (const [label, actual, expected] of platformChecks) expectEqual(label, actual, expected);

  const predicted = await factory.predictMarketAddress(nextMarketId);
  if (!CONTRACT.test(predicted)) fail(`predict_market_address devolveu um endereço inválido para o mercado ${nextMarketId}`);
  step(`Factory responde: próximo mercado #${nextMarketId}, ${predicted}`);

  if (latestLedger < dep.deployed_at_ledger) {
    fail(`o RPC está no ledger ${latestLedger}, antes do deploy (${dep.deployed_at_ledger})`);
  }
  step(`rede no ledger ${latestLedger} (deploy em ${dep.deployed_at_ledger})`);

  const token = chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor });
  const auditorKey = Buffer.from(pointToBytes(await token.auditorKey(dep.auditor.id))).toString("hex");
  expectEqual("auditor.key", auditorKey, dep.auditor.key);
  step("chave do auditor confere com o deployment");

  return { chain, platform, nextMarketId, latestLedger };
}
