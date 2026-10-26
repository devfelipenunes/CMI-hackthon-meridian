import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./app/src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          root: "./app",
          include: ["test/unit/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          restoreMocks: true,
        },
      },
      {
        resolve: {
          alias: {
            ...alias,
            // O pacote inteiro importa `localnet.ts`, que exige `file:` em `import.meta.url`.
            // O barril tem só os fakes e a auditoria, que é o que os fluxos usam.
            "@zolvency-cmi/testing": fileURLToPath(new URL("./app/test/flows/support/testing.ts", import.meta.url)),
          },
        },
        test: {
          name: "flows",
          root: "./app",
          include: ["test/flows/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./test/flows/setup.ts"],
          restoreMocks: true,
        },
      },
      {
        test: {
          name: "scripts",
          root: ".",
          include: ["scripts/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "bundle",
          root: ".",
          include: ["app/test/bundle/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "browser",
          root: "./app",
          include: ["test/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
