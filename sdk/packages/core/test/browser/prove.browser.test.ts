import { commands } from "@vitest/browser/context";
import { describe, expect, it } from "vitest";

import { ArtifactSet, verifyArtifacts } from "@zolvency-cmi/artifacts";
import devSources from "../../../artifacts/dev-sources.json" with { type: "json" };

import { browserBackendLoader } from "../../src/platform/browser/bb-loader.js";
import { createProver } from "../../src/proving/prover.js";
import { legsScenario } from "../helpers/legs.js";

declare const __REPO_ROOT__: string;

async function devArtifactsInBrowser(names: string[]): Promise<ArtifactSet> {
  const files = new Map<string, Uint8Array>();
  const sums = new Map<string, string>();
  for (const name of names) {
    for (const path of [`circuits/${name}.json`, `vks/${name}.vk.bin`]) {
      const src = (devSources.files as Record<string, { from: string; sha256: string }>)[path]!;
      const url = `/@fs${__REPO_ROOT__}${src.from}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
      files.set(path, new Uint8Array(await res.arrayBuffer()));
      sums.set(path, src.sha256);
    }
  }
  const set = new ArtifactSet(files, sums, { contractsTag: "dev" });
  verifyArtifacts(set);
  return set;
}

const bench: Record<string, unknown> = {
  userAgent: navigator.userAgent,
  hardwareConcurrency: navigator.hardwareConcurrency,
  crossOriginIsolated: globalThis.crossOriginIsolated,
};

describe("prova no navegador (S-14)", () => {
  const { setSpender, legs } = legsScenario();
  let prover: ReturnType<typeof createProver>;

  it("set_spender proves in Chromium (verified locally)", async () => {
    const artifacts = await devArtifactsInBrowser(["set_spender", "spender_transfer"]);
    prover = createProver({ artifacts, backendLoader: browserBackendLoader(), threads: navigator.hardwareConcurrency });
    const t0 = performance.now();
    const r = await prover.prove("set_spender", setSpender.inputs);
    bench.setSpenderFirstMs = Math.round(performance.now() - t0);
    expect(r.proof.length).toBe(14_592);
    expect(await prover.verify("set_spender", r)).toBe(true);
  });

  it("proxy bid_validity (spender_transfer) proves in Chromium", async () => {
    const t0 = performance.now();
    const r = await prover.prove("spender_transfer", legs.seller.inputs);
    bench.proxyBidValidityMs = Math.round(performance.now() - t0);
    expect(await prover.verify("spender_transfer", r)).toBe(true);
  });

  it("the bidder's two proofs (warm backend) fit the S-14 budget of ~30 s", async () => {
    const t0 = performance.now();
    await prover.prove("set_spender", setSpender.inputs);
    await prover.prove("spender_transfer", legs.seller.inputs);
    bench.twoProofsWarmMs = Math.round(performance.now() - t0);
    expect(bench.twoProofsWarmMs as number).toBeLessThan(30_000);
  });

  it("records proving time and wasm size", async () => {
    const wasm = performance
      .getEntriesByType("resource")
      .filter((e) => (e as PerformanceResourceTiming).name.includes(".wasm")) as PerformanceResourceTiming[];
    bench.wasmFiles = wasm.map((e) => ({ name: e.name.split("/").pop(), bytes: e.decodedBodySize }));
    bench.wasmTotalBytes = wasm.reduce((s, e) => s + e.decodedBodySize, 0);
    await commands.writeFile(`${__REPO_ROOT__}test-results/browser-bench.json`, JSON.stringify(bench, null, 2));
    await prover.destroy();
    expect(bench.setSpenderFirstMs).toBeGreaterThan(0);
  });
});
