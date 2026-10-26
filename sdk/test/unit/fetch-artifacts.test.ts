import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/fetch-artifacts.sh", import.meta.url));

function fakeRelease(opts: { corrupt: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  mkdirSync(join(dir, "vks"));
  const content = Buffer.from("vk-bytes");
  writeFileSync(join(dir, "vks/bid_validity.vk.bin"), content);
  const sum = createHash("sha256").update(opts.corrupt ? Buffer.from("other") : content).digest("hex");
  writeFileSync(join(dir, "SHA256SUMS"), `${sum}  vks/bid_validity.vk.bin\n`);
  return dir;
}

function run(release: string) {
  const dest = mkdtempSync(join(tmpdir(), "dest-"));
  const r = spawnSync("bash", [SCRIPT, "v0.0.0-test", "--from-dir", release], {
    env: { ...process.env, ARTIFACTS_RELEASES_DIR: dest },
    encoding: "utf8",
  });
  return { r, out: join(dest, "v0.0.0-test") };
}

describe("fetch-artifacts.sh", () => {
  it("rejects a release whose SHA256SUMS does not match and writes nothing", () => {
    const { r, out } = run(fakeRelease({ corrupt: true }));
    expect(r.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("installs a release whose SHA256SUMS matches", () => {
    const { r, out } = run(fakeRelease({ corrupt: false }));
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, "vks/bid_validity.vk.bin"), "utf8")).toBe("vk-bytes");
    expect(existsSync(join(out, "SHA256SUMS"))).toBe(true);
  });

  it("fails without a tag", () => {
    const r = spawnSync("bash", [SCRIPT], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });
});
