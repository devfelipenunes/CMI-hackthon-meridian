import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/depcruise", import.meta.url));

describe("fronteiras (dependency-cruiser)", () => {
  function cruise(): string {
    try {
      execFileSync(`${ROOT}node_modules/.bin/depcruise`, ["src", "--config", `${ROOT}.dependency-cruiser.cjs`, "--output-type", "err"], { cwd: FIXTURE, encoding: "utf8" });
      return "";
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? "");
    }
  }

  it("rejects api → keys and a scheduler that touches the database", () => {
    const out = cruise();
    expect(out).toContain("api-not-keys");
    expect(out).toContain("scheduler-is-pure");
  });
});
