const path = require("node:path");

module.exports = {
  forbidden: [
    {
      name: "app-no-operator",
      severity: "error",
      comment: "O app fala com a rede pelo SDK do usuário; o keeper do operador é outro sistema.",
      from: { path: "^app/src" },
      to: { path: "(sdk/)?packages/operator" },
    },
    {
      name: "app-no-testing",
      severity: "error",
      comment: "Fixtures do pacote de teste não podem vazar para o bundle.",
      from: { path: "^app/src" },
      to: { path: "(sdk/)?packages/testing" },
    },
    {
      name: "pages-no-stellar-sdk",
      severity: "error",
      comment: "Operações clássicas ficam em src/wallet; páginas usam hooks.",
      from: { path: "^app/src/(pages|components|hooks)" },
      to: { path: "(@stellar/stellar-sdk|sdk/packages/.*/node_modules/@stellar/stellar-sdk)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules/(?!@zolvency-cmi|@stellar)" },
    exclude: { path: "app/test" },
    tsConfig: { fileName: path.join(__dirname, "app/tsconfig.json") },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
