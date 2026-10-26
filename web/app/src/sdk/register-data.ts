import type { RegisterDataProvider } from "@zolvency-cmi/client";
import type { ContractId, FactoryPort } from "@zolvency-cmi/core";

type FactoryReader = Pick<FactoryPort, "nextMarketId" | "predictMarketAddress"> & { address: ContractId };

export class StaticRegisterDataProvider implements RegisterDataProvider {
  readonly #factory: FactoryReader;
  readonly #registerData: Uint8Array | null;

  constructor({ factory, registerData }: { factory: FactoryReader; registerData: Uint8Array | null }) {
    this.#factory = factory;
    this.#registerData = registerData;
  }

  async forNextMarket(): Promise<{ marketId: bigint; address: ContractId; registerData: Uint8Array }> {
    if (this.#registerData === null) {
      throw new Error("This environment has no operator register-data configured.");
    }
    const marketId = await this.#factory.nextMarketId();
    const address = await this.#factory.predictMarketAddress(marketId);
    return { marketId, address, registerData: this.#registerData };
  }
}

export function decodeRegisterData(text: string | null): Uint8Array | null {
  if (text === null || text === "") return null;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error("configured register-data is not valid base64.");
  }
}
