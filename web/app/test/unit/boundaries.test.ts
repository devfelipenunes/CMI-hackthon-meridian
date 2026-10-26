import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "app/src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const sources = files(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("bundle boundaries", () => {
  it("never imports the operator or the testing fixtures", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/@zolvency-cmi\/(operator|testing)/);
    }
  });

  it("keeps @stellar/stellar-sdk inside the wallet and SDK infrastructure", () => {
    const allowed = (path: string): boolean => path.startsWith("wallet/") || path.startsWith("sdk/");
    for (const { path, text } of sources) {
      if (!allowed(path)) expect(text, path).not.toMatch(/@stellar\/stellar-sdk/);
    }
  });

  it("reads the operator environment only from scripts, never from app", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/CMI_OPERATOR_/);
      expect(text, path).not.toMatch(/CMI_REGISTER_DATA/);
    }
  });

  it("never shows a calendar date: time is a duration from the ledger clock", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/Intl\.DateTimeFormat|toLocaleDateString|toLocaleTimeString|toISOString|formatDateTime|datetime-local|type="date"/);
    }
  });
});
