import type { Logger } from "pino";

import type { AlertService } from "../alerts/service.js";
import type { ChainPorts } from "../chain/ports.js";
import { TERMINAL, type Repos } from "../db/repos.js";
import { errorCode } from "../errors.js";

export const CURSOR_KEY = "factory_cursor";

export async function discoverMarkets(d: { ports: ChainPorts; repos: Repos; alerts: AlertService; logger: Logger; ledger: number }): Promise<bigint[]> {
  const { ports, repos, ledger } = d;
  const cursor = BigInt(repos.meta.get(CURSOR_KEY) ?? "0");
  const next = await ports.factory.nextMarketId();
  const added: bigint[] = [];
  for (let id = cursor + 1n; id < next; id++) {
    const address = await ports.factory.getMarketAddress(id);
    let version: string | null = null;
    let supported = true;
    try {
      version = await ports.versionOf(address);
    } catch (e) {
      if (errorCode(e) !== "UnsupportedContractsVersion") throw e;
      supported = false;
    }
    const auction = ports.auction(address);
    const market = await auction.getMarket();
    const status = await auction.getState();
    const grace = market.finalizationGraceLedgers;
    repos.markets.insert({
      marketId: id,
      address,
      seller: market.seller,
      quotaAsset: market.params.quotaAsset,
      totalQuotas: market.params.totalQuotas,
      minPricePerQuota: market.params.minPricePerQuota,
      closeLedger: market.params.closeLedger,
      graceLedgers: grace,
      finalizeByLedger: market.params.closeLedger + grace,
      status,
      bidCount: await auction.getBidCount(),
      contractsVersion: version,
      supported,

      nextCheckLedger: supported && !TERMINAL.includes(status) ? ledger : null,
    });
    repos.meta.set(CURSOR_KEY, id.toString());
    added.push(id);
    d.logger.info({ marketId: id, address, status, supported }, "market discovered");
    if (!supported) {
      d.alerts.raise({
        severity: "warning",
        kind: "UnsupportedMarket",
        marketId: id,
        bidIndex: null,
        message: `market ${id} runs an Auction version this SDK does not support; it is not operated`,
      });
    }
  }
  repos.meta.set("last_discovery_ledger", String(ledger));
  return added;
}
