

module.exports = {
  forbidden: [
    {
      name: "client-not-operator",
      comment: "As chaves do operador nunca podem entrar num bundle de navegador.",
      severity: "error",
      from: { path: "(^|/)packages/client/" },
      to: { path: "(^|/)packages/operator/" },
    },
    {
      name: "core-not-roles",
      comment: "core é a base: não conhece client nem operator.",
      severity: "error",
      from: { path: "(^|/)packages/core/" },
      to: { path: "(^|/)packages/(client|operator)/" },
    },
    {
      name: "artifacts-standalone",
      comment: "artifacts não depende de nenhum outro pacote do SDK.",
      severity: "error",
      from: { path: "(^|/)packages/artifacts/" },
      to: { path: "(^|/)packages/(core|client|operator|testing)/" },
    },
    {
      name: "core-no-node-builtins",
      comment: "core roda no navegador; node:* só em core/src/platform/node.",
      severity: "error",
      from: { path: "(^|/)packages/core/src/", pathNot: "(^|/)packages/core/src/platform/node/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "published-not-testing",
      comment: "Fakes e helpers de teste nunca vão para um pacote publicado.",
      severity: "error",
      from: { path: "(^|/)packages/(artifacts|core|client|operator)/src/" },
      to: { path: "(^|/)packages/testing/" },
    },
  ],
  options: {
    doNotFollow: { path: "(node_modules|third_party)" },
    exclude: { path: "(^|/)(node_modules|test/fixtures|third_party|dist)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
