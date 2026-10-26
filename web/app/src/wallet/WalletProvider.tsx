import type { WalletAdapter } from "@zolvency-cmi/core";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { Role } from "@/domain/market";
import { connectDevWallet, connectFreighter, disconnectWallet } from "./kit";

const MODE_KEY = "cmi.mode";

type WalletKind = "freighter" | "dev";

interface Wallet {
  address: string | null;
  kind: WalletKind | null;
  adapter: WalletAdapter | null;
  connecting: boolean;
  mode: Role;
  setMode: (mode: Role) => void;
  connect: (kind: WalletKind, secret?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<Wallet | null>(null);

function storedMode(): Role {
  try {
    return localStorage.getItem(MODE_KEY) === "company" ? "company" : "investor";
  } catch {
    return "investor";
  }
}

export function WalletProvider({ passphrase, children }: { passphrase: string; children: ReactNode }) {
  const [adapter, setAdapter] = useState<WalletAdapter | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [mode, setModeState] = useState<Role>(storedMode);

  const connect = useCallback(
    async (next: WalletKind, secret?: string) => {
      setConnecting(true);
      try {
        const connected = next === "freighter" ? await connectFreighter(passphrase) : connectDevWallet(secret ?? "");
        setAdapter(connected);
        setKind(next);
      } finally {
        setConnecting(false);
      }
    },
    [passphrase],
  );

  const disconnect = useCallback(async () => {
    if (kind === "freighter") await disconnectWallet();
    setAdapter(null);
    setKind(null);
  }, [kind]);

  const setMode = useCallback((next: Role) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      return;
    }
  }, []);

  const value = useMemo<Wallet>(
    () => ({
      address: adapter?.address ?? null,
      kind,
      adapter,
      connecting,
      mode,
      setMode,
      connect,
      disconnect,
    }),
    [adapter, kind, connecting, mode, setMode, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (wallet === null) throw new Error("useWallet fora do WalletProvider");
  return wallet;
}
