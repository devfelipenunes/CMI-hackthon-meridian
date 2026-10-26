import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["packages/*/test/unit/**/*.test.ts", "test/unit/**/*.test.ts", "e2e/test/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "parity", include: ["packages/*/test/parity/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "circuits", include: ["packages/*/test/circuits/**/*.test.ts"], testTimeout: 120_000 },
      },
      {
        extends: true,
        test: { name: "proving", include: ["packages/*/test/proving/**/*.test.ts"], testTimeout: 300_000, hookTimeout: 300_000 },
      },
      {

        extends: true,
        test: {
          name: "integration",
          include: ["packages/*/test/integration/**/*.test.ts", "examples/*/test/integration/**/*.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {

        extends: true,
        test: { name: "release", include: ["test/release/**/*.test.ts"], testTimeout: 600_000, hookTimeout: 600_000 },
      },
      {

        extends: true,
        test: { name: "examples", include: ["examples/*/test/*.test.ts"], testTimeout: 600_000, hookTimeout: 600_000 },
      },
      {

        extends: true,
        define: { __REPO_ROOT__: JSON.stringify(fileURLToPath(new URL(".", import.meta.url))) },
        optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"] },
        server: {
          headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
          fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
        },
        test: {
          name: "browser",
          include: ["packages/*/test/browser/**/*.browser.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          browser: { enabled: true, provider: "playwright", headless: true, instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
});
