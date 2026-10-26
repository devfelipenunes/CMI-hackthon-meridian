import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import { loadConfig, type NetworkConfig } from "./schema";

const ConfigContext = createContext<NetworkConfig | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const config = useQuery({
    queryKey: ["network-config"],
    queryFn: () => loadConfig(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  if (config.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="flex items-center gap-3 text-sm text-ink-2" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          Reading the network configuration…
        </div>
      </main>
    );
  }

  if (config.isError) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-prose">
          <p className="label">Configuration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">The app could not open</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            The <code className="font-mono text-xs">/config/testnet.json</code> file did not load. Check your connection
            and reload the page.
          </p>
          <button
            type="button"
            onClick={() => void config.refetch()}
            className="mt-6 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return <ConfigContext.Provider value={config.data}>{children}</ConfigContext.Provider>;
}

export function useConfig(): NetworkConfig {
  const config = useContext(ConfigContext);
  if (config === null) throw new Error("useConfig outside ConfigProvider");
  return config;
}
