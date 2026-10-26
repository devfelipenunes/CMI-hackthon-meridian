import { createHash } from "node:crypto";
import { Writable } from "node:stream";

import { Secret } from "@zolvency-cmi/core";
import { FAKE_PLATFORM } from "@zolvency-cmi/testing";

import type { ServiceConfig } from "../../src/config/load.js";
import { openDb, type Db } from "../../src/db/open.js";
import { repos as makeRepos } from "../../src/db/repos.js";
import { loadMasterKey } from "../../src/keys/seal.js";
import { DbOperatorKeyStore } from "../../src/keys/store.js";
import { createLogger, type Logger } from "../../src/observability/logger.js";
import { buildService, type Service } from "../../src/service.js";
import { SK_ENV, SK_OP, SUBMITTER_SECRET, TOKEN, World } from "./world.js";

export const MASTER_HEX = "11".repeat(32);
export const READ_KEY = "read-key-for-tests";
export const ADMIN_KEY = "admin-key-for-tests";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export function testConfig(over: Partial<ServiceConfig["tuning"]> = {}): ServiceConfig {
  return {
    network: "local",
    deploymentPath: "/dev/null",
    deployment: {
      rpcUrl: "http://localhost:8000/rpc",
      networkPassphrase: "Standalone Network ; February 2017",
      contracts: { factory: FAKE_PLATFORM.bidVerifier, token: TOKEN, auditor: FAKE_PLATFORM.allocationVerifier, underlying: FAKE_PLATFORM.feeAsset },
      auditor: { id: 0, key: "00".repeat(64) },
      feeWallet: FAKE_PLATFORM.feeWallet,
    },
    release: null,
    db: { path: ":memory:" },
    masterKey: { hex: MASTER_HEX },
    api: { host: "127.0.0.1", port: 0, readKeySha256: sha(READ_KEY), adminKeySha256: sha(ADMIN_KEY), corsOrigins: ["http://seller.example"] },
    tuning: {
      reconcileLedgers: 60,
      discoveryEveryLedgers: 12,
      backoffMaxLedgers: 120,
      deadlineWarnLedgers: 720,
      submitterMinStroops: 20n * 10_000_000n,
      secondsPerLedger: 5,
      loopIntervalMs: 10,
      ...over,
    },
    alertWebhookUrl: null,
    logLevel: "debug",
  };
}

export function memoryLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString("utf8"));
      cb();
    },
  });
  return { logger: createLogger({ level: "debug", destination: dest }), lines };
}

export function seededDb(): Db {
  const db = openDb(":memory:");
  const keys = new DbOperatorKeyStore(makeRepos(db).keys, loadMasterKey({ hex: MASTER_HEX }));
  keys.put("spender", new Secret(SK_OP.toString(16)));
  keys.put("envelope", new Secret(SK_ENV.toString(16)));
  keys.put("submitter", new Secret(SUBMITTER_SECRET));
  return db;
}

export interface TestService extends Service {
  world: World;
  lines: string[];

  step(ledgers?: number): ReturnType<Service["loop"]["runOnce"]>;
}

export async function testService(o: { world?: World; db?: Db; tuning?: Partial<ServiceConfig["tuning"]>; retry?: { maxAttempts: number }; webhook?: (url: string, body: unknown) => Promise<void>; config?: Partial<ServiceConfig>; now?: () => number } = {}): Promise<TestService> {
  const world = o.world ?? new World();
  const { logger, lines } = memoryLogger();
  const config = { ...testConfig(o.tuning), ...o.config };
  const s = await buildService({
    config,
    logger,
    ports: world.ports(),
    prover: world.prover,
    db: o.db ?? seededDb(),
    ...(o.retry === undefined ? {} : { retry: o.retry }),
    ...(o.webhook === undefined ? {} : { webhookPost: o.webhook }),
    ...(o.now === undefined ? {} : { now: o.now }),
  });
  return {
    ...s,
    world,
    lines,
    async step(ledgers = 1) {
      world.clock.advanceBy(ledgers);
      return s.loop.runOnce();
    },
  };
}

export async function runUntil(s: TestService, until: () => Promise<boolean> | boolean, max = 200): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (await until()) return i;
    await s.step(1);
  }
  throw new Error(`runUntil: condition not reached in ${max} loops`);
}
