import { Networks } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { LOCALNET, TESTNET, bidWindow, ledgersFor, setTestNetwork, testNetwork } from "../../src/index.js";

describe("rede de teste ativa", () => {
  afterEach(() => setTestNetwork(LOCALNET));

  it("is the local quickstart by default", () => {
    expect(testNetwork()).toBe(LOCALNET);
    expect(LOCALNET.secondsPerLedger).toBe(1);
    expect(LOCALNET.secondsPerBid).toBe(30);
  });

  it("switches to testnet: RPC, passphrase, friendbot and ledger time", () => {
    setTestNetwork(TESTNET);
    expect(testNetwork()).toEqual({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: Networks.TESTNET,
      friendbotUrl: "https://friendbot.stellar.org",
      secondsPerLedger: 5,
      secondsPerBid: 90,
    });
  });

  it("bidWindow gives n bids twice their network budget, in ledgers", () => {
    expect(bidWindow(5)).toBe(300);
    setTestNetwork(TESTNET);
    expect(bidWindow(5)).toBe(180);
  });

  it("ledgersFor converts a time budget into ledgers of the active network", () => {
    expect(ledgersFor(300)).toBe(300);
    setTestNetwork(TESTNET);
    expect(ledgersFor(300)).toBe(60);
    expect(ledgersFor(7)).toBe(2);
  });
});
