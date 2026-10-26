import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIST = join(process.cwd(), "app/dist");
const MIB = 1024 * 1024;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function modules(): string[] {
  return JSON.parse(readFileSync(join(DIST, "modules.json"), "utf8")) as string[];
}

function entryScripts(): string[] {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!.replace(/^\//, ""));
}

describe("production bundle", () => {
  it("keeps the operator and the testing fixtures out", () => {
    const ids = modules();
    const forbidden = ids.filter((id) => /@zolvency-cmi\/(operator|testing)/.test(id));
    expect(forbidden).toEqual([]);
  });

  it("never embeds the operator environment names", () => {
    const texts = walk(DIST)
      .filter((path) => /\.(js|html|json)$/.test(path))
      .map((path) => readFileSync(path, "utf8"));
    for (const text of texts) {
      expect(text).not.toMatch(/CMI_OPERATOR_/);
      expect(text).not.toMatch(/CMI_REGISTER_DATA/);
    }
  });

  it("stays inside the initial and total JS budgets", () => {
    const initial = entryScripts().reduce((sum, path) => sum + statSync(join(DIST, path)).size, 0);

    expect(initial, "JS inicial").toBeLessThanOrEqual(2 * MIB);

    const total = walk(DIST)
      .filter((path) => path.endsWith(".js"))
      .reduce((sum, path) => sum + statSync(path).size, 0);
    expect(total, "JS total").toBeLessThanOrEqual(16 * MIB);
  });

  it("ships the circuits, their VKs and the checksums", () => {
    const files = walk(join(DIST, "artifacts")).map((path) => path.slice(join(DIST, "artifacts").length + 1));
    expect(files).toEqual(
      expect.arrayContaining([
        "SHA256SUMS",
        "circuits/register.json",
        "circuits/set_spender.json",
        "circuits/bid_validity.json",
        "circuits/revoke_spender.json",
        "vks/register.vk.bin",
        "vks/set_spender.vk.bin",
        "vks/bid_validity.vk.bin",
        "vks/revoke_spender.vk.bin",
      ]),
    );
  });
});
