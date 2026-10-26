import { describe, expect, it, vi } from "vitest";

import { StaticRegisterDataProvider, decodeRegisterData } from "@/sdk/register-data";

const factory = {
  address: "CFACTORY",
  nextMarketId: vi.fn(async () => 14n),
  predictMarketAddress: vi.fn(async (id: bigint) => `CPREDICTED${id}`),
  getMarketAddress: vi.fn(),
  getPlatformConfig: vi.fn(),
  createMarket: vi.fn(),
};

describe("StaticRegisterDataProvider", () => {
  it("returns the next id, the predicted address and the configured bytes", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const provider = new StaticRegisterDataProvider({ factory, registerData: bytes });
    await expect(provider.forNextMarket()).resolves.toEqual({ marketId: 14n, address: "CPREDICTED14", registerData: bytes });
    expect(factory.nextMarketId).toHaveBeenCalledOnce();
    expect(factory.predictMarketAddress).toHaveBeenCalledWith(14n);
  });

  it("fails with a setup message when the environment has no operator data", async () => {
    const provider = new StaticRegisterDataProvider({ factory, registerData: null });
    await expect(provider.forNextMarket()).rejects.toThrow(/register-data/);
  });

  it("decodes base64 without keeping the source string", () => {
    expect(Array.from(decodeRegisterData("AQIDBA==") ?? [])).toEqual([1, 2, 3, 4]);
    expect(decodeRegisterData(null)).toBeNull();
    expect(decodeRegisterData("")).toBeNull();
  });
});
