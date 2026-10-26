import { describe, expect, it } from "vitest";

import { countdown, durationToLedgers, formatDuration, formatLedgerDistance, ledgerToDate, relativeToLedger } from "@/domain/time";

const anchor = { ledger: 5_000_000, at: Date.parse("2026-10-20T12:00:00Z"), secondsPerLedger: 5 };

describe("ledger clock", () => {
  it("converts ledger to an estimated date", () => {
    expect(ledgerToDate(5_000_120, anchor).toISOString()).toBe("2026-10-20T12:10:00.000Z");
    expect(ledgerToDate(5_000_000, anchor).toISOString()).toBe("2026-10-20T12:00:00.000Z");
  });

  it("converts a duration to ledgers, rounding up", () => {
    expect(durationToLedgers(5, "minutes", 5)).toBe(60);
    expect(durationToLedgers(1, "hours", 5)).toBe(720);
    expect(durationToLedgers(7, "days", 5)).toBe(120_960);

    expect(durationToLedgers(7, "minutes", 6)).toBe(70);
    expect(durationToLedgers(1, "minutes", 7)).toBe(9);
  });

  it("makes the 30-day boundary exact", () => {
    expect(durationToLedgers(30, "days", 5)).toBe(518_400);
    expect(durationToLedgers(30 * 24 * 60 + 1, "minutes", 5)).toBe(518_412);
  });

  it("renders a countdown that never goes negative", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(countdown(new Date(now + 65_000), now)).toEqual({ days: 0, hours: 0, minutes: 1, seconds: 5, expired: false });
    expect(countdown(new Date(now - 10_000), now).expired).toBe(true);
    expect(countdown(new Date(now - 10_000), now).seconds).toBe(0);
  });

  it("formats durations in words, never as a date", () => {
    expect(formatDuration(45)).toBe("less than a minute");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(300)).toBe("5 minutes");
    expect(formatDuration(3_660)).toBe("1 hour 1 minute");
    expect(formatDuration(7_200)).toBe("2 hours");
    expect(formatDuration(90_000)).toBe("1 day 1 hour");
    expect(formatDuration(432_000)).toBe("5 days");
  });

  it("describes a ledger relative to the current one", () => {
    expect(formatLedgerDistance(5_000_060, 5_000_000, 5)).toBe("in 5 minutes");
    expect(formatLedgerDistance(4_913_600, 5_000_000, 5)).toBe("5 days ago");
    expect(formatLedgerDistance(5_000_000, 5_000_000, 5)).toBe("now");
    expect(formatLedgerDistance(5_000_001, 5_000_000, 5)).toBe("in less than a minute");
  });

  it("uses the live ledger when known, the anchor otherwise, and nothing without a clock", () => {
    expect(relativeToLedger(5_000_120, 5_000_060, anchor)).toBe("in 5 minutes");
    expect(relativeToLedger(5_000_120, null, anchor)).toBe("in 10 minutes");
    expect(relativeToLedger(5_000_120, 5_000_060, null)).toBeNull();
  });
});
