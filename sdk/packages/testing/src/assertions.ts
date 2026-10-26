import { MemoryLogger } from "./logger.js";

type SecretValue = bigint | Uint8Array;

const MIN_DECIMAL_DIGITS = 3;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function needles(secret: SecretValue, index: number): string[] {
  if (secret instanceof Uint8Array) return [toHex(secret)];
  const decimal = secret.toString();
  if (decimal.replace("-", "").length < MIN_DECIMAL_DIGITS) {
    throw new Error(`assertNoSecretLeak: secret #${index} is too short to be searched safely; use a distinctive value`);
  }
  const hex = secret.toString(16);
  return [decimal, hex, hex.padStart(64, "0")];
}

function render(sink: unknown, seen = new Set<unknown>()): string {
  if (sink === null || sink === undefined) return "";
  if (typeof sink === "string") return sink;
  if (typeof sink === "bigint" || typeof sink === "number" || typeof sink === "boolean") {
    return typeof sink === "bigint" ? `${sink} ${sink.toString(16)}` : String(sink);
  }
  if (sink instanceof Uint8Array) return toHex(sink);
  if (typeof sink !== "object") return String(sink);
  if (seen.has(sink)) return "";
  seen.add(sink);
  if (sink instanceof MemoryLogger) return render(sink.entries, seen);
  if (sink instanceof Error) {
    return [sink.message, sink.stack ?? "", render((sink as { cause?: unknown }).cause, seen), render({ ...sink }, seen)].join(" ");
  }
  if (Array.isArray(sink)) return sink.map((v) => render(v, seen)).join(" ");

  const maybeJson = sink as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === "function" && !(sink instanceof Date)) return render(maybeJson.toJSON(), seen);
  return Object.entries(sink)
    .map(([k, v]) => `${k} ${render(v, seen)}`)
    .join(" ");
}

export function assertNoSecretLeak(secrets: readonly SecretValue[], sinks: readonly unknown[]): void {
  const haystack = sinks.map((s) => render(s)).join("\n").toLowerCase();
  secrets.forEach((secret, index) => {
    for (const needle of needles(secret, index)) {
      if (haystack.includes(needle.toLowerCase())) {
        throw new Error(`assertNoSecretLeak: secret #${index} found in a sink`);
      }
    }
  });
}
