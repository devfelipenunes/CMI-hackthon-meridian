import type { ChainPorts } from "../chain/ports.js";
import type { MarketRow, Repos } from "../db/repos.js";

export async function syncMarket(d: { ports: ChainPorts; repos: Repos }, m: MarketRow, ledger: number): Promise<void> {
  const auction = d.ports.auction(m.address);
  const status = await auction.getState();
  const bidCount = await auction.getBidCount();
  const finalizeBy = (await auction.getFinalizeByLedger()) ?? m.closeLedger + m.graceLedgers;
  let filled = 0;
  for (let i = 0; i < bidCount; i++) {
    const r = await auction.getBidRecord(i);
    filled += r.filledQuantity;
    d.repos.bids.upsert({
      marketId: m.marketId,
      bidIndex: i,
      bidder: r.bidder,
      participantId: r.participantId,
      requestedQuantity: r.requestedQuantity,
      filledQuantity: r.filledQuantity,
      status: r.status,

      delegationLive: r.status === "Pending" ? await d.ports.token.isSpender(r.bidder, m.address) : null,
    });
  }
  const allocated = status === "Finalized" || status === "Settled";
  d.repos.markets.updateState(m.marketId, { status, bidCount, finalizeByLedger: finalizeBy, unsold: allocated ? m.totalQuotas - filled : null, ledger });
}
