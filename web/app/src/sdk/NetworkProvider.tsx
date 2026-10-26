import { useQuery } from "@tanstack/react-query";
import { MarketsApi } from "@zolvency-cmi/client";
import { ChainClient, chainAuctionPort, chainFactoryPort } from "@zolvency-cmi/core";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import type { NetworkConfig } from "@/config/schema";
import type { LedgerAnchor } from "@/domain/time";

interface Network {
  config: NetworkConfig;
  chain: ChainClient;

  markets: MarketsApi;
  ledger: number | null;
  ledgerError: boolean;
  anchor: LedgerAnchor | null;
}

const NetworkContext = createContext<Network | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const config = useConfig();

  const chain = useMemo(
    () =>
      new ChainClient({
        rpcUrl: config.rpcUrl,
        networkPassphrase: config.passphrase,
        allowHttp: config.rpcUrl.startsWith("http://"),
      }),
    [config.rpcUrl, config.passphrase],
  );

  const markets = useMemo(
    () =>
      new MarketsApi({
        factory: chainFactoryPort({ chain, address: config.contracts.factory }),
        auction: (address) => chainAuctionPort({ chain, address }),
      }),
    [chain, config.contracts.factory],
  );

  const ledger = useQuery({
    queryKey: ["ledger", config.rpcUrl, config.passphrase],
    queryFn: () => chain.latestLedger(),
    refetchInterval: 5_000,
    retry: 2,
    staleTime: 2_000,
  });

  const anchor = useMemo<LedgerAnchor | null>(() => {
    if (ledger.data === undefined) return null;
    return { ledger: ledger.data, at: ledger.dataUpdatedAt, secondsPerLedger: config.secondsPerLedger };
  }, [ledger.data, ledger.dataUpdatedAt, config.secondsPerLedger]);

  const value = useMemo<Network>(
    () => ({
      config,
      chain,
      markets,
      ledger: ledger.data ?? null,
      ledgerError: ledger.isError,
      anchor,
    }),
    [config, chain, markets, ledger.data, ledger.isError, anchor],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Network {
  const network = useContext(NetworkContext);
  if (network === null) throw new Error("useNetwork fora do NetworkProvider");
  return network;
}

export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
