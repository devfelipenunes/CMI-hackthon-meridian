import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ServiceError } from "../errors.js";

export interface Deployment {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: { factory: string; token: string; auditor: string; underlying: string };
  auditor: { id: number; key: string };
  feeWallet: string;
}

export type Network = "testnet" | "local";

export interface ServiceConfig {
  network: Network;
  deploymentPath: string;
  deployment: Deployment;

  release: string | null;
  db: { path: string };

  masterKey: { file: string } | { hex: string };
  api: { host: string; port: number; readKeySha256: string; adminKeySha256: string; corsOrigins: string[] };
  tuning: {
    reconcileLedgers: number;
    discoveryEveryLedgers: number;
    backoffMaxLedgers: number;
    deadlineWarnLedgers: number;
    submitterMinStroops: bigint;
    secondsPerLedger: number;
    loopIntervalMs: number;
  };
  alertWebhookUrl: string | null;
  logLevel: string;
}

const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^[GC][A-Z2-7]{55}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function loadConfig(env: NodeJS.ProcessEnv, opts: { readFile?: (path: string) => string } = {}): ServiceConfig {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const problems: string[] = [];
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v.trim() === "" ? undefined : v.trim();
  };
  const required = (name: string): string => {
    const v = get(name);
    if (v === undefined) problems.push(`${name} is required`);
    return v ?? "";
  };
  const int = (name: string, dflt: number, min: number): number => {
    const v = get(name);
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) {
      problems.push(`${name} must be an integer >= ${min}`);
      return dflt;
    }
    return n;
  };

  const networkRaw = required("CMI_NETWORK");
  if (networkRaw !== "" && networkRaw !== "testnet" && networkRaw !== "local") problems.push("CMI_NETWORK must be testnet or local");
  const network: Network = networkRaw === "testnet" ? "testnet" : "local";

  const masterFile = get("CMI_MASTER_KEY_FILE");
  const masterHex = get("CMI_MASTER_KEY");
  if (masterFile === undefined && masterHex === undefined) problems.push("CMI_MASTER_KEY_FILE or CMI_MASTER_KEY is required");
  if (masterFile === undefined && masterHex !== undefined && !/^[0-9a-fA-F]{64}$/.test(masterHex)) problems.push("CMI_MASTER_KEY must be 32 bytes in hex");

  const readKey = required("CMI_API_KEY_READ_SHA256").toLowerCase();
  const adminKey = required("CMI_API_KEY_ADMIN_SHA256").toLowerCase();
  if (readKey !== "" && !SHA256.test(readKey)) problems.push("CMI_API_KEY_READ_SHA256 must be a sha256 in hex");
  if (adminKey !== "" && !SHA256.test(adminKey)) problems.push("CMI_API_KEY_ADMIN_SHA256 must be a sha256 in hex");
  if (readKey !== "" && readKey === adminKey) problems.push("CMI_API_KEY_READ_SHA256 and CMI_API_KEY_ADMIN_SHA256 must differ");

  const webhook = get("CMI_ALERT_WEBHOOK_URL") ?? null;
  if (webhook !== null && !/^https?:\/\//.test(webhook)) problems.push("CMI_ALERT_WEBHOOK_URL must be an http(s) URL");

  const minXlm = get("CMI_SUBMITTER_MIN_XLM") ?? "20";
  if (!/^\d+(\.\d{1,7})?$/.test(minXlm)) problems.push("CMI_SUBMITTER_MIN_XLM must be a decimal XLM amount");

  const secondsPerLedger = int("CMI_SECONDS_PER_LEDGER", network === "testnet" ? 5 : 1, 1);
  const deploymentPath = resolve(get("CMI_DEPLOYMENT") ?? `deployments/${network}.json`);

  let deployment: Deployment | null = null;
  if (problems.length === 0) {
    try {
      deployment = parseDeployment(JSON.parse(readFile(deploymentPath)));
    } catch (e) {
      problems.push(`deployment ${deploymentPath}: ${e instanceof SyntaxError ? "invalid JSON" : e instanceof Error ? e.message : "unreadable"}`);
    }
  }

  const config: Omit<ServiceConfig, "deployment"> = {
    network,
    deploymentPath,
    release: get("CMI_CONTRACTS_RELEASE") ?? null,
    db: { path: resolve(get("CMI_DB_PATH") ?? "data/operator.db") },
    masterKey: masterFile !== undefined ? { file: resolve(masterFile) } : { hex: masterHex ?? "" },
    api: {
      host: get("CMI_API_HOST") ?? "127.0.0.1",
      port: int("CMI_API_PORT", 8080, 0),
      readKeySha256: readKey,
      adminKeySha256: adminKey,
      corsOrigins: (get("CMI_CORS_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter((s) => s !== ""),
    },
    tuning: {
      reconcileLedgers: int("CMI_RECONCILE_LEDGERS", 60, 1),
      discoveryEveryLedgers: int("CMI_DISCOVERY_EVERY_LEDGERS", 12, 1),
      backoffMaxLedgers: int("CMI_BACKOFF_MAX_LEDGERS", 120, 1),
      deadlineWarnLedgers: int("CMI_DEADLINE_WARN_LEDGERS", 720, 1),
      submitterMinStroops: xlmToStroops(/^\d+(\.\d{1,7})?$/.test(minXlm) ? minXlm : "20"),
      secondsPerLedger,
      loopIntervalMs: int("CMI_LOOP_INTERVAL_MS", secondsPerLedger * 1000, 100),
    },
    alertWebhookUrl: webhook,
    logLevel: get("CMI_LOG_LEVEL") ?? "info",
  };
  if (problems.length > 0 || deployment === null) throw new ServiceError("ConfigInvalid", `invalid configuration: ${problems.join("; ")}`);
  return { ...config, deployment };
}

export function parseDeployment(json: unknown): Deployment {
  if (typeof json !== "object" || json === null) throw new Error("not an object");
  const j = json as Record<string, unknown>;
  const str = (o: Record<string, unknown>, path: string, key: string): string => {
    const v = o[key];
    if (typeof v !== "string" || v === "") throw new Error(`missing ${path}${key}`);
    return v;
  };
  const c = j["contracts"];
  const a = j["auditor"];
  if (typeof c !== "object" || c === null) throw new Error("missing contracts");
  if (typeof a !== "object" || a === null) throw new Error("missing auditor");
  const cc = c as Record<string, unknown>;
  const contract = (key: string): string => {
    const v = str(cc, "contracts.", key);
    if (!CONTRACT.test(v)) throw new Error(`contracts.${key} is not a contract id`);
    return v;
  };
  const aa = a as Record<string, unknown>;
  const key = str(aa, "auditor.", "key").toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(key)) throw new Error("auditor.key must be 128 hex");
  const feeWallet = str(j, "", "fee_wallet");
  if (!ACCOUNT.test(feeWallet)) throw new Error("fee_wallet is not an address");
  return {
    rpcUrl: str(j, "", "rpc_url"),
    networkPassphrase: str(j, "", "passphrase"),
    contracts: { factory: contract("factory"), token: contract("token"), auditor: contract("auditor"), underlying: contract("underlying") },
    auditor: { id: Number(aa["id"] ?? 0), key },
    feeWallet,
  };
}

export function xlmToStroops(xlm: string): bigint {
  const [int = "0", frac = ""] = xlm.split(".");
  return BigInt(int) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
}
