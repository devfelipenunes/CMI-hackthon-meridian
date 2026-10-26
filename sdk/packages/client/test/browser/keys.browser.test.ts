import { describe, expect, it } from "vitest";

import { addressToField } from "@zolvency-cmi/core";

import { BrowserKeyProvider } from "../../src/index.js";

const TOKEN_F = addressToField("CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F");
const ANA = "GDYWZQYPXOS3ALAAXMEUL4A6ZDMXKVVONTJEZOLE6DLT7WJRN666VBOV";

describe("BrowserKeyProvider no Chromium", () => {
  it("persists across provider instances on the real IndexedDB (same origin, as after a reload)", async () => {
    const dbName = `cmi-test-${crypto.randomUUID()}`;
    const first = new BrowserKeyProvider({ network: "testnet", dbName });
    const created = await first.create(ANA, TOKEN_F);
    first.close();

    const second = new BrowserKeyProvider({ network: "testnet", dbName });
    const got = await second.get(ANA, TOKEN_F);
    expect(got!.sk.expose()).toBe(created.sk.expose());
    second.close();
  });
});
