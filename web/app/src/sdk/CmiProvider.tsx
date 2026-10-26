import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserKeyProvider, BrowserOpeningStore, connectClient, type CmiClient } from "@zolvency-cmi/client";
import { addressToField, walletSigner, type Signer } from "@zolvency-cmi/core";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { decodeRegisterData } from "@/sdk/register-data";
import { useWallet } from "@/wallet/WalletProvider";
import { loadBrowserArtifacts } from "./artifacts";
import { useNetwork } from "./NetworkProvider";
import { LazyProver } from "./prover";

export interface CmiResources {
  client: CmiClient;
  signer: Signer;
  keys: BrowserKeyProvider;
  openings: BrowserOpeningStore;
  keyBackupStatus: () => Promise<{ backupRequired: boolean }>;
}

const CmiContext = createContext<CmiResources | null>(null);

export function CmiProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { chain } = useNetwork();
  const { adapter, address } = useWallet();

  const resources = useMemo<CmiResources | null>(() => {
    if (adapter === null) return null;
    const keys = new BrowserKeyProvider({ network: config.passphrase });
    const openings = new BrowserOpeningStore({ network: config.passphrase });
    const prover = new LazyProver(() => loadBrowserArtifacts());
    const signer = walletSigner(adapter);
    const client = connectClient({
      chain,
      contracts: { factory: config.contracts.factory, token: config.contracts.token, auditor: config.contracts.auditor },
      signer,
      keys,
      openings,
      prover,
    });
    return { client, signer, keys, openings, keyBackupStatus: () => keys.backupStatus(address ?? adapter.address, addressToField(config.contracts.token)) };
  }, [adapter, address, chain, config.passphrase, config.contracts.auditor, config.contracts.factory, config.contracts.token]);

  const queryClient = useQueryClient();
  useEffect(() => {
    if (resources === null) return;
    let alive = true;
    void (async () => {
      try {
        if (address !== null && (await resources.client.token.account(address)) !== null) {
          await resources.client.account.sync();
        }
      } catch {
        void 0;
      }
      if (alive) await queryClient.invalidateQueries({ queryKey: ["account"] });
    })();
    return () => {
      alive = false;
    };
  }, [resources, address, queryClient]);

  return <CmiContext.Provider value={resources}>{children}</CmiContext.Provider>;
}

export function useCmi(): CmiResources | null {
  return useContext(CmiContext);
}

export function useRequireCmi(): CmiResources {
  const resources = useCmi();
  if (resources === null) throw new Error("wallet not connected");
  return resources;
}

export interface AccountStatus {
  onChain: boolean;
  hasKey: boolean;
  backupRequired: boolean;
  openings: boolean;
}

export function useAccountStatus() {
  const resources = useCmi();
  const config = useConfig();
  const { address } = useWallet();
  return useQuery({
    queryKey: ["account", address, "status"],
    enabled: resources !== null && address !== null,
    queryFn: async (): Promise<AccountStatus> => {
      if (resources === null || address === null) throw new Error("no wallet");
      const field = addressToField(config.contracts.token);
      const [onChain, keys, openings] = await Promise.all([
        resources.client.token.account(address),
        resources.keys.get(address, field),
        resources.openings.get(address, field).catch(() => null),
      ]);
      let backupRequired = false;
      if (keys !== null) backupRequired = (await resources.keys.backupStatus(address, field)).backupRequired;
      return { onChain: onChain !== null, hasKey: keys !== null, backupRequired, openings: openings !== null };
    },
  });
}

export function useRegisterData(): Uint8Array | null {
  const config = useConfig();
  return useMemo(() => decodeRegisterData(config.registerData), [config.registerData]);
}

export { loadBrowserArtifacts };
