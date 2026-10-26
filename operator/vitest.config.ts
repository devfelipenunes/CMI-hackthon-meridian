import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
      { extends: true, test: { name: "integration", include: ["test/integration/**/*.test.ts"], testTimeout: 60_000 } },
      { extends: true, test: { name: "api", include: ["test/api/**/*.test.ts"] } },

      { extends: true, test: { name: "proving", include: ["test/proving/**/*.test.ts"], testTimeout: 600_000, hookTimeout: 600_000 } },
      {

        extends: true,
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],

          testTimeout: 7_200_000,
          hookTimeout: 1_800_000,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
