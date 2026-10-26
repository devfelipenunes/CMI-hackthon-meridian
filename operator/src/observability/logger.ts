import { Secret, type Logger as SdkLogger } from "@zolvency-cmi/core";
import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger } from "pino";

const REDACT = [
  "secret",
  "*.secret",
  "spenderKey",
  "envelopeKey",
  "masterKey",
  "registerData",
  "proof",
  "witness",
  "secrets",
  "*.spenderKey",
  "*.envelopeKey",
  "*.masterKey",
  "*.registerData",
  "*.proof",
  "*.witness",
  "*.secrets",
  "headers.x-api-key",
  "req.headers.x-api-key",
];

export function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Secret) return "[redacted]";
  if (typeof value === "bigint") return value.toString();
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  if (value instanceof Error) return { name: value.name, message: value.message, ...("code" in value ? { code: (value as { code: unknown }).code } : {}) };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
  return out;
}

export function createLogger(opts: { level: string; destination?: DestinationStream }): Logger {
  return pino(
    {
      level: opts.level,
      redact: { paths: REDACT, censor: "[redacted]" },
      hooks: {
        logMethod(args, method) {

          if (args.length > 0 && typeof args[0] === "object") args[0] = scrub(args[0]) as object;
          method.apply(this, args);
        },
      },
    },
    opts.destination,
  );
}

export function sdkLogger(log: Logger): SdkLogger {
  return {
    debug: (msg, data) => log.debug(data ?? {}, msg),
    info: (msg, data) => log.info(data ?? {}, msg),
    warn: (msg, data) => log.warn(data ?? {}, msg),
    error: (msg, data) => log.error(data ?? {}, msg),
  };
}
