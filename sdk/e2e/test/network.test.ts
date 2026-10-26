import { describe, expect, it } from "vitest";

import { evidenceFile, networkOf } from "../src/network.js";

describe("rede do E2E", () => {
  it("local reads deployments/local.json and keeps the evidence name", () => {
    const n = networkOf("local");
    expect(n.label).toBe("quickstart-local");
    expect(n.deployment).toMatch(/deployments\/local\.json$/);
    expect(evidenceFile("v0.1.0-rc.4", n, "abc1234")).toBe("v0.1.0-rc.4.json");
    expect(evidenceFile("dev", n, "abc1234", "all")).toBe("dev-all-abc1234.json");
  });

  it("testnet reads the contracts deployments/testnet.json and suffixes the evidence", () => {
    const n = networkOf("testnet");
    expect(n.label).toBe("testnet");
    expect(n.deployment).toMatch(/contracts\/deployments\/testnet\.json$/);
    expect(evidenceFile("v0.1.0-rc.4", n, "abc1234")).toBe("v0.1.0-rc.4-testnet.json");
  });

  it("refuses an unknown network", () => {
    expect(() => networkOf("mainnet")).toThrow(/rede/);
  });
});
