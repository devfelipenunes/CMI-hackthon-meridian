import { Keypair } from "@stellar/stellar-sdk";
import { Secret, keypairSigner } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { registerFeeWallet } from "../../src/boot/fee-wallet.js";
import { TOKEN, World } from "../helpers/world.js";

describe("bootstrap fee-wallet", () => {
  it("registers the account on the token and is a no-op if already registered", async () => {
    const w = new World();
    const signer = keypairSigner(Keypair.random().secret());
    const d = { token: w.token, tokenAddress: TOKEN, auditorId: 0, prover: w.prover, signer, tokenSk: new Secret(0x1234_5678_9abcn) };
    expect(await w.token.account(signer.address)).toBeNull();
    expect((await registerFeeWallet(d)).registered).toBe(true);
    expect(await w.token.account(signer.address)).not.toBeNull();
    expect(w.prover.proved.filter((p) => p.circuit === "register")).toHaveLength(1);
    expect((await registerFeeWallet(d)).registered).toBe(false);
    expect(w.prover.proved.filter((p) => p.circuit === "register")).toHaveLength(1);
  });
});
