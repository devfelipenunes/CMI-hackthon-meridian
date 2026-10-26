import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-toolchain.sh", import.meta.url));

function runWith(fakes: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "toolchain-"));
  for (const [bin, out] of Object.entries(fakes)) {
    const path = join(dir, bin);
    writeFileSync(path, `#!/usr/bin/env bash\necho "${out}"\n`);
    chmodSync(path, 0o755);
  }
  return spawnSync("bash", [SCRIPT], {
    env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
    encoding: "utf8",
  });
}

describe("check-toolchain.sh", () => {
  it("fails with Node < 22", () => {
    const r = runWith({ node: "v20.11.0", pnpm: "10.34.6" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Node/);
  });

  it("fails without pnpm", () => {
    const r = runWith({ node: "v22.23.3" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pnpm/);
  });

  it("passes with Node 22 and pnpm", () => {
    const r = runWith({ node: "v22.23.3", pnpm: "10.34.6" });
    expect(r.status).toBe(0);
  });
});
