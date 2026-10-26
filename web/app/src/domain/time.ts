

export interface LedgerAnchor {

  ledger: number;

  at: number;
  secondsPerLedger: number;
}

export const SECONDS_PER_DAY = 86_400;

export function ledgerToDate(ledger: number, anchor: LedgerAnchor): Date {
  return new Date(anchor.at + (ledger - anchor.ledger) * anchor.secondsPerLedger * 1_000);
}

export type DurationUnit = "minutes" | "hours" | "days";

const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3_600, days: SECONDS_PER_DAY };

export function durationToLedgers(amount: number, unit: DurationUnit, secondsPerLedger: number): number {
  return Math.ceil((amount * UNIT_SECONDS[unit]) / secondsPerLedger);
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function countdown(target: Date, now = Date.now()): Countdown {
  const total = Math.max(0, Math.floor((target.getTime() - now) / 1_000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    expired: target.getTime() <= now,
  };
}

export function formatCountdown(value: Countdown): string {
  if (value.expired) return "ended";
  if (value.days > 0) return `${value.days}d ${value.hours}h`;
  if (value.hours > 0) return `${value.hours}h ${value.minutes}m`;
  if (value.minutes > 0) return `${value.minutes}m ${value.seconds}s`;
  return `${value.seconds}s`;
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return "less than a minute";
  const days = Math.floor(total / SECONDS_PER_DAY);
  const hours = Math.floor((total % SECONDS_PER_DAY) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${plural(days, "day")} ${plural(hours, "hour")}` : plural(days, "day");
  if (hours > 0) return minutes > 0 ? `${plural(hours, "hour")} ${plural(minutes, "minute")}` : plural(hours, "hour");
  return plural(minutes, "minute");
}

export function formatLedgerDistance(target: number, current: number, secondsPerLedger: number): string {
  if (target === current) return "now";
  const text = formatDuration(Math.abs(target - current) * secondsPerLedger);
  return target > current ? `in ${text}` : `${text} ago`;
}

export function relativeToLedger(target: number, ledger: number | null, anchor: LedgerAnchor | null): string | null {
  if (anchor === null) return null;
  return formatLedgerDistance(target, ledger ?? anchor.ledger, anchor.secondsPerLedger);
}

export function formatLedger(ledger: number): string {
  return `ledger ${ledger.toLocaleString("en-US")}`;
}
