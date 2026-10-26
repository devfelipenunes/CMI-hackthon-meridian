import { describe, expect, it } from "vitest";

import { Secret, addressToField } from "@zolvency-cmi/core";

import { BrowserOpeningStore } from "../../src/index.js";

const TOKEN_F = addressToField("CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F");
const ANA = "GDYWZQYPXOS3ALAAXMEUL4A6ZDMXKVVONTJEZOLE6DLT7WJRN666VBOV";

describe("BrowserOpeningStore no Chromium", () => {
  it("persists across store instances on the real IndexedDB (same origin, as after a reload)", async () => {
    const dbName = `cmi-test-${crypto.randomUUID()}`;
    const openings = { spendable: { v: 300_000n, r: 0x1234n }, receiving: { v: 58_000n, r: 0x5678n }, lastDeposit: 300_000n, syncedLedger: 42 };
    const first = new BrowserOpeningStore({ network: "testnet", dbName });
    await first.put(ANA, TOKEN_F, new Secret(openings));
    first.close();

    const second = new BrowserOpeningStore({ network: "testnet", dbName });
    expect((await second.get(ANA, TOKEN_F))!.expose()).toEqual(openings);
    second.close();
  });
});
