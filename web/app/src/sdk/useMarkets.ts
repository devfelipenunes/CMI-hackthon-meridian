import { useQuery } from "@tanstack/react-query";
import { chainAuctionPort, chainFactoryPort, type AuctionEvent, type MarketStatus } from "@zolvency-cmi/core";
import type { MarketView, MarketsApi } from "@zolvency-cmi/client";
import { useEffect, useState } from "react";

import { useNetwork } from "./NetworkProvider";

const TERMINAL: readonly MarketStatus[] = ["Settled", "Cancelled"];

const LIST_CONCURRENCY = 12;

export async function listMarkets(
  markets: Pick<MarketsApi, "get">,
  nextMarketId: bigint,
  status?: MarketStatus[],
): Promise<MarketView[]> {
  const ids: bigint[] = [];
  for (let id = 1n; id < nextMarketId; id += 1n) ids.push(id);

  const views = new Array<MarketView>(ids.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      if (id === undefined) return;
      views[index] = await markets.get(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIST_CONCURRENCY, ids.length) }, worker));

  return status === undefined ? views : views.filter((market) => status.includes(market.status));
}

export function useMarkets(status?: MarketStatus[]) {
  const { markets, chain, config } = useNetwork();
  return useQuery({
    queryKey: ["markets", config.rpcUrl, status ?? "all"],
    queryFn: async () => {
      const next = await chainFactoryPort({ chain, address: config.contracts.factory }).nextMarketId();
      return listMarkets(markets, next, status);
    },

    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useMarket(marketId: bigint | null) {
  const { markets, chain, config } = useNetwork();
  return useQuery({
    queryKey: ["market", config.rpcUrl, marketId?.toString() ?? "none"],
    enabled: marketId !== null,
    queryFn: async () => {
      if (marketId === null) throw new Error("sem mercado");

      const next = await chainFactoryPort({ chain, address: config.contracts.factory }).nextMarketId();
      if (marketId < 1n || marketId >= next) return null;
      return markets.get(marketId);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && TERMINAL.includes(status) ? false : 6_000;
    },
  });
}

export function useMarketEvents(marketId: bigint | null, address: string | null, status: MarketStatus | undefined) {
  const { chain, config } = useNetwork();
  const [events, setEvents] = useState<AuctionEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const terminal = status !== undefined && TERMINAL.includes(status);

  useEffect(() => {
    setEvents(null);
    setError(null);
    if (marketId === null || address === null) return;
    let cancelled = false;
    const fromLedger = config.deployedAtLedger;

    const load = async (): Promise<void> => {
      try {
        const auction = chainAuctionPort({ chain, address });
        const next = await auction.events({ startLedger: fromLedger });
        if (!cancelled) {
          setEvents(next);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause);
      }
    };

    void load();
    if (terminal) return () => {
      cancelled = true;
    };
    const timer = window.setInterval(() => void load(), 6_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [marketId, address, status, terminal, chain, config.deployedAtLedger]);

  return { events, error };
}
