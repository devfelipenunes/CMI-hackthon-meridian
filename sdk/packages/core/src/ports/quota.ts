import { Address } from "@stellar/stellar-sdk";

import type { ChainClient } from "../chain/client.js";
import type { AccountId, ContractId } from "../chain/events.js";
import { CmiError } from "../errors/CmiError.js";

export interface QuotaPort {
  hasTrustline(asset: ContractId, account: AccountId): Promise<boolean>;
}

export function chainQuotaPort(cfg: { chain: ChainClient }): QuotaPort {
  return {
    async hasTrustline(asset, account) {
      try {
        await cfg.chain.simulate(asset, "balance", [new Address(account).toScVal()]);
        return true;
      } catch (e) {
        if (e instanceof CmiError && e.code === "TxFailed") return false;
        throw e;
      }
    },
  };
}
