

module.exports = {
  forbidden: [
    {
      name: "api-not-keys",
      comment: "A API nunca lê chaves: só serviços que não devolvem segredo.",
      severity: "error",
      from: { path: "^src/api/" },
      to: { path: "^src/keys/" },
    },
    {
      name: "scheduler-is-pure",
      comment: "A agenda é pura (tabela): sem banco, chain, rede ou node:*.",
      severity: "error",
      from: { path: "^src/scheduler/" },
      to: { path: "^src/(db|chain|keys|api|runner|markets|alerts)/|^node:|better-sqlite3|fastify" },
    },
    {
      name: "only-chain-builds-adapters",
      comment: "Só src/chain monta os adaptadores reais do SDK (ChainClient, chain*Port).",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/(chain|keys|cli)/|^src/main\\.ts" },
      to: { path: "@stellar/stellar-sdk" },
    },
    {
      name: "no-testing-in-src",
      comment: "O pacote de testes do SDK (fakes) é só de dev.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "@zolvency-cmi/(testing|client)" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules|sdk" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
