import { describe, expect, it } from "vitest";

import { loadConfig, parseDeployment, xlmToStroops } from "../../src/config/load.js";

const C = (n: number) => `C${String.fromCharCode(65 + n).repeat(55)}`;
const DEPLOYMENT = {
  rpc_url: "http://localhost:8000/rpc",
  passphrase: "Standalone Network ; February 2017",
  admin: "GADMIN",
  contracts: { underlying: C(0), verifier: C(1), auditor: C(2), token: C(3), bid_verifier: C(4), allocation_verifier: C(5), settlement_verifier: C(6), factory: C(7) },
  auction_wasm_hash: "ab",
  auditor: { id: 0, key: "a".repeat(128) },
  fee_wallet: `G${"B".repeat(55)}`,
};
const ENV = {
  CMI_NETWORK: "local",
  CMI_MASTER_KEY: "1".repeat(64),
  CMI_API_KEY_READ_SHA256: "a".repeat(64),
  CMI_API_KEY_ADMIN_SHA256: "b".repeat(64),
};
const readFile = () => JSON.stringify(DEPLOYMENT);

describe("config (passo 0.2)", () => {
  it("loads a complete env with defaults", () => {
    const c = loadConfig(ENV, { readFile });
    expect(c.network).toBe("local");
    expect(c.deployment.contracts.factory).toBe(C(7));
    expect(c.tuning).toMatchObject({ reconcileLedgers: 60, discoveryEveryLedgers: 12, backoffMaxLedgers: 120, deadlineWarnLedgers: 720, secondsPerLedger: 1, loopIntervalMs: 1000 });
    expect(c.tuning.submitterMinStroops).toBe(200_000_000n);
    expect(c.api).toMatchObject({ host: "127.0.0.1", port: 8080, corsOrigins: [] });
    expect(c.release).toBeNull();
  });

  it("testnet defaults to 5 seconds per ledger (OP-22)", () => {
    expect(loadConfig({ ...ENV, CMI_NETWORK: "testnet" }, { readFile }).tuning.secondsPerLedger).toBe(5);
  });

  it("rejects a missing required var naming it, not its value", () => {
    expect(() => loadConfig({ ...ENV, CMI_API_KEY_READ_SHA256: "" }, { readFile })).toThrow(/CMI_API_KEY_READ_SHA256 is required/);
  });

  it("rejects a master key that is not 32 bytes without echoing it", () => {
    const bad = "deadbeef".repeat(3);
    try {
      loadConfig({ ...ENV, CMI_MASTER_KEY: bad }, { readFile });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/CMI_MASTER_KEY must be 32 bytes/);
      expect((e as Error).message).not.toContain(bad);
      expect((e as { code: string }).code).toBe("ConfigInvalid");
    }
  });

  it("rejects equal read and admin keys", () => {
    expect(() => loadConfig({ ...ENV, CMI_API_KEY_ADMIN_SHA256: ENV.CMI_API_KEY_READ_SHA256 }, { readFile })).toThrow(/must differ/);
  });

  it("reads factory, token, auditor and rpc from the deployment file", () => {
    const d = parseDeployment(DEPLOYMENT);
    expect(d).toMatchObject({ rpcUrl: DEPLOYMENT.rpc_url, contracts: { factory: C(7), token: C(3), auditor: C(2) }, feeWallet: DEPLOYMENT.fee_wallet });
  });

  it("CMI_NETWORK=local reads deployments/local.json by default", () => {
    let asked = "";
    loadConfig(ENV, { readFile: (p) => ((asked = p), readFile()) });
    expect(asked).toMatch(/deployments\/local\.json$/);
  });

  it("an unreadable deployment is a ConfigInvalid", () => {
    expect(() =>
      loadConfig(ENV, {
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toThrow(/deployment/);
    expect(() => loadConfig(ENV, { readFile: () => JSON.stringify({ ...DEPLOYMENT, contracts: { ...DEPLOYMENT.contracts, factory: "x" } }) })).toThrow(/contracts\.factory/);
  });

  it("converts XLM to stroops", () => {
    expect(xlmToStroops("20")).toBe(200_000_000n);
    expect(xlmToStroops("0.5")).toBe(5_000_000n);
    expect(xlmToStroops("1.0000001")).toBe(10_000_001n);
  });
});
