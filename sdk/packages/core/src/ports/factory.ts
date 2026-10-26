import { scValToNative } from "@stellar/stellar-sdk";

import { FACTORY_SPEC } from "../bindings/factory.js";
import type { ChainClient } from "../chain/client.js";
import type { ContractId } from "../chain/events.js";
import type { Signer } from "../chain/signer.js";
import type { MarketParams, PlatformConfig } from "../config/types.js";
import { CmiError } from "../errors/CmiError.js";
import { addrVal, bytesVal, lazySpec, paramsToNative, platformFromNative, u64Val, udt } from "./scval.js";

export interface FactoryPort {
  readonly address: ContractId;
  nextMarketId(): Promise<bigint>;
  predictMarketAddress(id: bigint): Promise<ContractId>;
  getMarketAddress(id: bigint): Promise<ContractId>;
  getPlatformConfig(): Promise<PlatformConfig>;

  createMarket(seller: Signer, params: MarketParams, registerData: Uint8Array): Promise<{ marketId: bigint; address: ContractId }>;
}

const spec = lazySpec(FACTORY_SPEC);

export function chainFactoryPort(cfg: { chain: ChainClient; address: ContractId }): FactoryPort {
  const { chain, address } = cfg;
  const opts = { errors: "Factory" } as const;
  const read = (method: string, args = [] as ReturnType<typeof u64Val>[]) => chain.simulate(address, method, args, opts);

  return {
    address,
    nextMarketId: async () => BigInt(scValToNative(await read("next_market_id")) as bigint),
    predictMarketAddress: async (id) => scValToNative(await read("predict_market_address", [u64Val(id)])) as string,
    getMarketAddress: async (id) => scValToNative(await read("get_market_address", [u64Val(id)])) as string,
    getPlatformConfig: async () => platformFromNative(spec().funcResToNative("get_platform_config", await read("get_platform_config"))),
    createMarket: async (seller, params, registerData) => {
      const r = await chain.invoke(
        address,
        "create_market",
        [addrVal(seller.address), spec().nativeToScVal(paramsToNative(params), udt("MarketParams")), bytesVal(registerData)],
        seller,
        opts,
      );
      if (r.returnValue === undefined) throw new CmiError("TxFailed", "create_market: no return value");
      const [marketId, market] = scValToNative(r.returnValue) as [bigint, string];
      return { marketId: BigInt(marketId), address: market };
    },
  };
}
