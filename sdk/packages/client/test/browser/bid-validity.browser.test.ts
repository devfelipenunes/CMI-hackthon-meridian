import { commands } from "@vitest/browser/context";
import { ArtifactSet, verifyArtifacts } from "@zolvency-cmi/artifacts";
import { browserBackendLoader, createProver } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import devSources from "../../../artifacts/dev-sources.json" with { type: "json" };
import { anaWitness } from "../helpers/ana.js";

declare const __REPO_ROOT__: string;

async function devArtifacts(names: string[]): Promise<ArtifactSet> {
  const files = new Map<string, Uint8Array>();
  const sums = new Map<string, string>();
  for (const name of names) {
    for (const path of [`circuits/${name}.json`, `vks/${name}.vk.bin`]) {
      const src = (devSources.files as Record<string, { from: string; sha256: string }>)[path]!;
      const res = await fetch(`/@fs${__REPO_ROOT__}${src.from}`);
      if (!res.ok) throw new Error(`fetch ${src.from}: HTTP ${res.status}`);
      files.set(path, new Uint8Array(await res.arrayBuffer()));
      sums.set(path, src.sha256);
    }
  }
  const set = new ArtifactSet(files, sums, { contractsTag: "dev" });
  verifyArtifacts(set);
  return set;
}

describe("bid_validity no navegador (S-14, remedição no 4.2)", () => {
  it("proves and verifies the real bid_validity in Chromium", async () => {
    const prover = createProver({ artifacts: await devArtifacts(["bid_validity"]), backendLoader: browserBackendLoader(), threads: navigator.hardwareConcurrency });
    const w = anaWitness();
    const t0 = performance.now();
    const first = await prover.prove("bid_validity", w.inputs);
    const firstMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    await prover.prove("bid_validity", w.inputs);
    const warmMs = Math.round(performance.now() - t1);
    expect(first.proof.length).toBe(14_592);
    expect(await prover.verify("bid_validity", first)).toBe(true);
    await commands.writeFile(
      `${__REPO_ROOT__}test-results/browser-bench-bid-validity.json`,
      JSON.stringify({ userAgent: navigator.userAgent, crossOriginIsolated: globalThis.crossOriginIsolated, firstMs, warmMs }, null, 2),
    );
    await prover.destroy();
    expect(warmMs).toBeLessThan(30_000);
  });
});
