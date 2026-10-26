

const SCALE = 10_000_000n;
const MAX_QUOTA = 4_294_967_295;

export class AmountError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

export function parseXlm(input: string): bigint {
  const text = input.trim();
  if (text.length === 0 || text.length > 40) throw new AmountError("Enter a value in XLM.");
  let whole: string;
  let fraction: string;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,7})?$/.test(text)) {
    const [rawWhole, rawFraction = ""] = text.split(".") as [string, string?];
    whole = rawWhole.replaceAll(",", "");
    fraction = rawFraction;
  } else {
    const parts = text.split(".");
    if (parts.length > 2 || text.endsWith(".")) throw invalid();
    const [rawWhole, rawFraction = ""] = parts as [string, string?];
    if (!/^\d+$/.test(rawWhole) || (rawFraction !== "" && !/^\d{1,7}$/.test(rawFraction))) throw invalid();
    whole = rawWhole;
    fraction = rawFraction;
  }
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(7, "0"));
}

const invalid = (): AmountError => new AmountError("Use a positive value with up to 7 decimal places.");

export function formatXlm(value: bigint, opts: { maxFractionDigits?: number } = {}): string {
  const max = Math.min(7, Math.max(0, opts.maxFractionDigits ?? 7));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % SCALE).toString().padStart(7, "0").slice(0, max).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

export function formatXlmWithUnit(value: bigint, opts?: { maxFractionDigits?: number }): string {
  return `${formatXlm(value, opts)} XLM`;
}

export function parseQuotas(input: string): number {
  const text = input.trim();
  if (!/^\d+$/.test(text)) throw new AmountError("Enter a whole number of quotas.");
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_QUOTA) {
    throw new AmountError(`Enter between 1 and ${MAX_QUOTA.toLocaleString("en-US")} quotas.`);
  }
  return value;
}

export function formatQuotas(value: number): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? "quota" : "quotas"}`;
}

export function quotaValue(quantity: bigint, pricePerQuota: bigint): bigint {
  if (quantity < 0n || pricePerQuota < 0n) throw new AmountError("Quantity and price cannot be negative.");
  return quantity * pricePerQuota;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
