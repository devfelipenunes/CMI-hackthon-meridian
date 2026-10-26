

import { connectChain, connectProver } from "./chain/connect.js";
import { loadDotEnv } from "./cli/env.js";
import { loadConfig, type ServiceConfig } from "./config/load.js";
import { errorCode } from "./errors.js";
import { createLogger } from "./observability/logger.js";
import { buildService, type Service } from "./service.js";

loadDotEnv();

let config: ServiceConfig;
try {
  config = loadConfig(process.env);
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel });
const ports = connectChain(config);
const prover = connectProver(config);

let service: Service;
try {
  service = await buildService({ config, logger, ports, prover });
} catch (e) {
  logger.fatal({ code: errorCode(e), err: e }, "the service cannot start");
  await prover.destroy();
  process.exit(1);
}

const ac = new AbortController();
const loop = service.loop.run(ac.signal);
await service.api.listen({ host: config.api.host, port: config.api.port });
logger.info(
  { network: config.network, factory: config.deployment.contracts.factory, api: `http://${config.api.host}:${config.api.port}`, envelopeKind: service.boot.envelopeKey },
  "operator running (Swagger UI at /docs)",
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "stopping: finishing the current tick");
  ac.abort();
  await loop;
  await service.close();
  logger.info("stopped");
  process.exit(0);
}
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
