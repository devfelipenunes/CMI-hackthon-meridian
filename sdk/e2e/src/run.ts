

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadArtifacts, loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver } from "@zolvency-cmi/core";
import { loadLocalDeployment, setTestNetwork } from "@zolvency-cmi/testing";

import { RecordingChain } from "./chain.js";
import { evidenceFile, networkOf } from "./network.js";
import { runRc1 } from "./checks/rc1-lock-bid.js";
import { runRc2 } from "./checks/rc2-settlement.js";
import { runRc3 } from "./checks/rc3-full.js";
import { ROUND_CHECKS, ROUND_VKS, buildEvidence, roundOf, type Round } from "./evidence.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const CONTRACTS = join(REPO, "contracts");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

const git = (dir: string, ...a: string[]): string => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

async function main(): Promise<void> {
  const tag = arg("contracts");
  const network = arg("network") ?? "local";
  if (tag === undefined) throw new Error("uso: pnpm e2e --contracts <tag|dev> [--round rc1|rc2|rc3|all] --network local|testnet");
  const round = (arg("round") as Round | undefined) ?? roundOf(tag);
  if (!(round in ROUND_CHECKS)) throw new Error(`rodada desconhecida: ${round}`);
  const net = networkOf(network);
  setTestNetwork(net.test);

  const artifacts = tag === "dev" ? loadDevArtifacts() : loadArtifacts({ release: tag });
  const dep = loadLocalDeployment(net.deployment);
  const deployed = (JSON.parse(readFileSync(net.deployment, "utf8")) as { wasm_sha256: Record<string, string> }).wasm_sha256;

  const wasmDir = tag === "dev" ? join(CONTRACTS, "wasm") : join(REPO, "packages/artifacts/releases", tag, "wasm");
  const wasm = new Map<string, Uint8Array>([
    ["factory", readFileSync(tag === "dev" ? join(CONTRACTS, "target/wasm32v1-none/release/factory.wasm") : join(wasmDir, "factory.wasm"))],
    ["auction", readFileSync(join(wasmDir, "auction.wasm"))],
    ["confidential_token", readFileSync(join(CONTRACTS, "wasm/confidential_token.wasm"))],
    ["ultrahonk_verifier", readFileSync(join(CONTRACTS, "wasm/ultrahonk_verifier.wasm"))],
  ]);
  for (const [name, bytes] of wasm) {
    if (deployed[name] !== sha256(bytes)) throw new Error(`o ${name}.wasm implantado não é o arquivo usado (deploy ${deployed[name]?.slice(0, 12)}…, arquivo ${sha256(bytes).slice(0, 12)}…)`);
  }

  const chain = new RecordingChain({ rpcUrl: dep.rpcUrl, networkPassphrase: dep.networkPassphrase, allowHttp: dep.rpcUrl.startsWith("http://"), pollIntervalMs: 500 });
  const prover = createProver({ artifacts });
  const say = (m: string): void => void process.stdout.write(`${m}\n`);
  const title = { rc1: "rc.1 (lock + bid)", rc2: "rc.2 (settlement)", rc3: "rc.3 (leilão completo)", all: "completo (rc1 + rc2 + rc3)" }[round];
  say(`== E2E ${title}: contratos ${tag} @ ${git(CONTRACTS, "rev-parse", "--short", "HEAD")}, rede ${net.label} ==`);

  const contractsCommit = git(CONTRACTS, "rev-parse", "HEAD");
  const dirty = git(REPO, "status", "--porcelain", "--", "packages", "e2e", ":(exclude)e2e/evidence") !== "";
  const sdkCommit = `${git(REPO, "rev-parse", "HEAD")}${dirty ? "-dirty" : ""}`;
  const started = new Date();
  let checks;
  try {
    const rounds = round === "all" ? [runRc1, runRc2, runRc3] : [{ rc1: runRc1, rc2: runRc2, rc3: runRc3 }[round]];
    checks = [];
    for (const runRound of rounds) checks.push(...(await runRound({ chain, dep, prover, say })));
  } finally {
    await prover.destroy();
  }

  const missing = ROUND_CHECKS[round].filter((id) => !checks.some((c) => c.id === id));
  if (missing.length > 0) throw new Error(`checks ausentes: ${missing.join(", ")}`);

  const evidence = buildEvidence({
    contractsTag: tag,
    contractsCommit,
    sdkCommit,
    network: net.label,
    runAt: started,
    wasm,
    vks: new Map(ROUND_VKS[round].map((name) => [name, artifacts.vk(name)])),
    checks,
  });

  const out = join(REPO, "e2e/evidence", evidenceFile(tag, net, contractsCommit, round));
  mkdirSync(join(REPO, "e2e/evidence"), { recursive: true });
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  say(`\n== ${evidence.summary.pass} PASS, ${evidence.summary.fail} FAIL → ${out} ==`);
  process.exitCode = evidence.summary.fail === 0 ? 0 : 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    process.stderr.write(`E2E abortado: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  },
);
