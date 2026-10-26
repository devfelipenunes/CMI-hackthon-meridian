import type { Logger } from "@zolvency-cmi/core";

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  data?: Record<string, unknown>;
}

export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  #push(level: LogEntry["level"], msg: string, data?: Record<string, unknown>): void {
    this.entries.push(data === undefined ? { level, msg } : { level, msg, data });
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.#push("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.#push("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.#push("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.#push("error", msg, data);
  }
}
