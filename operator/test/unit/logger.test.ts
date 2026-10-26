import { readFileSync } from "node:fs";

import { Secret } from "@zolvency-cmi/core";
import { VERSION as OPERATOR_VERSION } from "@zolvency-cmi/operator";
import { describe, expect, it } from "vitest";

import { sdkLogger } from "../../src/observability/logger.js";
import { VERSION } from "../../src/version.js";
import { memoryLogger } from "../helpers/service.js";

describe("logger (passo 0.3, OP-11)", () => {
  it("Secret values are logged as [redacted], nested in objects and arrays", () => {
    const { logger, lines } = memoryLogger();
    logger.info({ a: new Secret(123456789n), nested: { list: [new Secret("sk-abc")] } }, "msg");
    const out = lines.join("");
    expect(out).not.toContain("123456789");
    expect(out).not.toContain("sk-abc");
    expect(out).toContain("[redacted]");
  });

  it("redacts known sensitive keys", () => {
    const { logger, lines } = memoryLogger();
    logger.info({ registerData: "AAAA-data", proof: "PROOF-bytes", witness: { x: 1 }, req: { headers: { "x-api-key": "k-123" } } }, "msg");
    const out = lines.join("");
    for (const s of ["AAAA-data", "PROOF-bytes", "k-123"]) expect(out).not.toContain(s);
  });

  it("bigint and bytes are serialized safely", () => {
    const { logger, lines } = memoryLogger();
    logger.info({ id: 42n, bytes: new Uint8Array(14_592) }, "msg");
    expect(lines.join("")).toContain('"id":"42"');
    expect(lines.join("")).toContain("[14592 bytes]");
  });

  it("the SDK logger adapter goes through the same redaction", () => {
    const { logger, lines } = memoryLogger();
    sdkLogger(logger).warn("bid without delegation", { secret: new Secret(5n), bidIndex: 1 });
    expect(lines.join("")).toContain('"bidIndex":1');
    expect(lines.join("")).not.toMatch(/"secret":"?5/);
  });
});

describe("versões", () => {
  it("VERSION matches package.json and the SDK operator package is installed", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(OPERATOR_VERSION).toBe("0.1.0");
  });
});
