import { AUCTION_ERRORS, FACTORY_ERRORS, TOKEN_ERRORS, CmiError, type CmiErrorCode } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { allLocalCodes, errorText, errorTextFrom } from "@/domain/errors";

const auctionCodes = Object.values(AUCTION_ERRORS).map((n) => `Auction.${n}`);
const factoryCodes = Object.values(FACTORY_ERRORS).map((n) => `Factory.${n}`);
const tokenCodes = Object.values(TOKEN_ERRORS).map((n) => `Token.${n}`);

const FALLBACK = "The operation could not be completed. Try again.";

describe("errorText", () => {
  it("covers every contract and local code with a real translation", () => {
    for (const code of [...auctionCodes, ...factoryCodes, ...tokenCodes, ...allLocalCodes]) {
      const t = errorText(code);
      expect(t.title, code).not.toBe("");
      expect(t.detail, code).not.toBe("");
      expect(t.detail, code).not.toBe(FALLBACK);
    }
  });

  it("keeps a recovery label for the actions the SDK announces", () => {
    expect(errorText("Auction.NoTrustline").recovery?.action).toBe("Enable quota");
    expect(errorText("Token.DelegationAlreadyExists").recovery?.action).toBe("Recover collateral");
    expect(errorText("ResourceContention").recovery?.action).toBe("Try again");
    expect(errorText("BalanceOutOfSync").recovery?.action).toBe("Import backup");
  });

  it("translates a CmiError by code and never exposes its message", () => {

    const t = errorTextFrom(new CmiError("Auction.BelowMinPrice" as CmiErrorCode, "price 123456 is below min 999999"));
    expect(t.title).toBe("Below the floor price");
    expect(JSON.stringify(t)).not.toContain("123456");
    expect(JSON.stringify(t)).not.toContain("999999");
  });

  it("recognises wallet errors without leaking raw text", () => {
    const t = errorTextFrom(new Error("User declined the request because it was scary"));
    expect(t.title).toBe("Signature declined");
    expect(JSON.stringify(t)).not.toContain("scary");
  });

  it("falls back safely for unknown codes and values", () => {
    expect(errorText("Nope.Whatever").detail).toBe(FALLBACK);
    for (const value of [undefined, null, 42, { message: "secret 7.5 XLM" }, "boom"]) {
      const t = errorTextFrom(value);
      expect(t.detail).toBe(FALLBACK);
      expect(JSON.stringify(t)).not.toContain("secret");
    }
  });

  it("maps network failures to a network message, not a transaction failure", () => {
    const t = errorTextFrom(new TypeError("fetch failed"));
    expect(t.title).toMatch(/network|respond/i);
  });
});
