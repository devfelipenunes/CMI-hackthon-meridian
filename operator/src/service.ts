import { randomUUID } from "node:crypto";

import type { Prover } from "@zolvency-cmi/core";
import { CmiOperator } from "@zolvency-cmi/operator";
import type { Logger } from "pino";

import { AlertService, type WebhookPost } from "./alerts/service.js";
import { buildApi, type ApiDeps, type OperatorStatus } from "./api/server.js";
import { bootChecks, type BootReport } from "./boot/checks.js";
import type { ChainPorts } from "./chain/ports.js";
import type { ServiceConfig } from "./config/load.js";
import { openDb, type Db } from "./db/open.js";
import { repos as makeRepos, type Repos } from "./db/repos.js";
import { ServiceError } from "./errors.js";
import { loadMasterKey } from "./keys/seal.js";
import { DbOperatorKeyStore } from "./keys/store.js";
import { RegisterDataProvider } from "./markets/register-data.js";
import { sdkLogger } from "./observability/logger.js";
import { InstanceLease } from "./runner/lease.js";
import { OperatorLoop } from "./runner/loop.js";
import { VERSION } from "./version.js";

export interface Service {
  config: ServiceConfig;
  db: Db;
  repos: Repos;
  keys: DbOperatorKeyStore;
  operator: CmiOperator;
  loop: OperatorLoop;
  alerts: AlertService;
  api: Awaited<ReturnType<typeof buildApi>>;
  boot: BootReport;

  close(): Promise<void>;
}

export interface ServiceDeps {
  config: ServiceConfig;
  logger: Logger;
  ports: ChainPorts;
  prover: Prover;

  db?: Db;
  readFile?: (path: string) => string;
  webhookPost?: WebhookPost;
  retry?: { maxAttempts: number };

  now?: () => number;
}

export async function buildService(d: ServiceDeps): Promise<Service> {
  const { config, logger, ports } = d;
  const db = d.db ?? openDb(config.db.path);
  const repos = makeRepos(db);
  const keys = new DbOperatorKeyStore(repos.keys, loadMasterKey(config.masterKey, d.readFile));
  const alerts = new AlertService({ repo: repos.alerts, logger, webhookUrl: config.alertWebhookUrl, ...(d.webhookPost === undefined ? {} : { post: d.webhookPost }) });

  const boot = await bootChecks({ ports, keys, deployment: config.deployment, minSubmitterStroops: config.tuning.submitterMinStroops });
  if (boot.fatal.length > 0) {
    db.close();
    throw new ServiceError("BootCheckFailed", `the service cannot start: ${boot.fatal.join("; ")}`);
  }
  for (const w of boot.warnings) alerts.raise(w);

  const operator = new CmiOperator({
    keys,
    factory: ports.factory,
    tokenAddress: config.deployment.contracts.token,
    prover: d.prover,
    logger: sdkLogger(logger),
    auction: (address) => ports.auction(address),
    token: ports.token,
  });
  const lease = new InstanceLease({ meta: repos.meta, holder: `${process.pid}-${randomUUID()}`, ...(d.now === undefined ? {} : { now: d.now }) });
  const loop = new OperatorLoop({ ports, operator, repos, alerts, lease, logger, tuning: config.tuning, ...(d.retry === undefined ? {} : { retry: d.retry }) });
  loop.prepareRestart();

  const registerData = new RegisterDataProvider({
    operator,
    factory: ports.factory,
    meta: repos.meta,
    spenderPublic: keys.publicOf("spender"),
    tokenAddress: config.deployment.contracts.token,
  });

  const submitterAddress = keys.publicOf("submitter");
  const status = async (): Promise<OperatorStatus> => {
    let latestLedger: number | null = null;
    let xlm: bigint | null = null;
    let nextMarketId: bigint | null = null;
    try {
      latestLedger = await ports.latestLedger();
      xlm = await ports.xlmBalance(submitterAddress);
      nextMarketId = await ports.factory.nextMarketId();
    } catch {
      // Status is best-effort: unavailable RPC fields remain null.
    }
    if (xlm !== null && xlm < config.tuning.submitterMinStroops) {
      alerts.raise({ severity: "warning", kind: "SubmitterLowBalance", marketId: null, bidIndex: null, message: `the submitter ${submitterAddress} has a low XLM balance` });
    }
    const counts = repos.markets.countByStatus();
    return {
      network: config.network,
      rpcUrl: config.deployment.rpcUrl,
      latestLedger,
      keeper: { running: loop.running, paused: loop.paused, lastLoopLedger: numOrNull(repos.meta.get("last_loop_ledger")), leader: loop.lastReport?.leader ?? false },
      discovery: { cursor: repos.meta.get("factory_cursor") ?? "0", nextMarketId: nextMarketId?.toString() ?? null, lastScanLedger: numOrNull(repos.meta.get("last_discovery_ledger")) },
      submitter: { address: submitterAddress, xlmBalance: xlm?.toString() ?? null },
      feeWallet: { address: config.deployment.feeWallet, registered: boot.feeWalletRegistered },
      envelopeKey: boot.envelopeKey ?? "custom",
      versions: { service: VERSION, contracts: config.release ?? "dev" },
      markets: counts,
      openAlerts: repos.alerts.countOpen(),
    };
  };

  const ready = async (): Promise<{ ok: boolean; failing: string[] }> => {
    const failing: string[] = [];
    try {
      db.prepare("SELECT 1").get();
    } catch {
      failing.push("database");
    }
    try {
      await ports.latestLedger();
    } catch {
      failing.push("rpc");
    }
    if (!loop.running) failing.push("loop");
    else if (loop.lastReport !== null && !loop.lastReport.leader) failing.push("lease");
    return { ok: failing.length === 0, failing };
  };

  const apiDeps: ApiDeps = {
    config,
    repos,
    loop,
    status,
    ready,
    registerData: () => registerData.forNextMarket(),
    latestLedger: () => ports.latestLedger(),
    logger,
  };
  const api = await buildApi(apiDeps);

  return {
    config,
    db,
    repos,
    keys,
    operator,
    loop,
    alerts,
    api,
    boot,
    async close() {
      loop.release();
      await api.close();
      await d.prover.destroy();
      db.close();
    },
  };
}

function numOrNull(s: string | null): number | null {
  return s === null ? null : Number(s);
}
