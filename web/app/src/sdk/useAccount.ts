import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CmiError, addressToField, type TxResult } from "@zolvency-cmi/core";

import { useConfig } from "@/config/ConfigProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { useAccountStatus, useCmi } from "./CmiProvider";

function useInvalidateAccount() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["account"] });
}

export function useSetupAccount() {
  const cmi = useCmi();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      const result = await cmi.client.account.ensureRegistered();
      return { backupRequired: result.backupRequired };
    },
    onSuccess: () => void invalidate(),
  });
}

export function useSyncAccount() {
  const cmi = useCmi();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      return cmi.client.account.sync();
    },
    onSuccess: () => void invalidate(),
  });
}

export function useBalance() {
  const cmi = useCmi();
  const { address } = useWallet();
  return useQuery({
    queryKey: ["account", address, "balance"],
    enabled: cmi !== null && address !== null,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      return cmi.client.account.balance();
    },
    retry: (count, error) =>
      !(error instanceof CmiError && (error.code === "Token.AccountNotRegistered" || error.code === "KeyNotFound")) && count < 2,
  });
}

export function useDeposit() {
  const cmi = useCmi();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async (amount: bigint): Promise<{ deposit: TxResult; merge: TxResult }> => {
      if (cmi === null) throw new Error("wallet not connected");
      await cmi.client.account.sync();
      const deposit = await cmi.client.account.deposit(amount);
      const merge = await cmi.client.account.merge();
      return { deposit, merge };
    },
    onSuccess: () => void invalidate(),
  });
}

export function useMerge() {
  const cmi = useCmi();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      await cmi.client.account.sync();
      return cmi.client.account.merge();
    },
    onSuccess: () => void invalidate(),
  });
}

export function useExportBackup() {
  const cmi = useCmi();
  return useMutation({
    mutationFn: async (password: string) => {
      if (cmi === null) throw new Error("wallet not connected");
      return cmi.client.account.exportBackup(password);
    },
  });
}

export function useImportBackup() {
  const invalidate = useInvalidateAccount();
  const cmi = useCmi();
  return useMutation({
    mutationFn: async ({ backup, password }: { backup: string; password: string }) => {
      if (cmi === null) throw new Error("wallet not connected");
      const result = await cmi.client.account.importBackup(backup, password);
      await cmi.client.account.sync();
      return result;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useForgetKey() {
  const cmi = useCmi();
  const config = useConfig();
  const { address } = useWallet();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async () => {
      if (cmi === null || address === null) throw new Error("wallet not connected");
      const field = addressToField(config.contracts.token);
      await cmi.keys.forget(address, field);
      await cmi.openings.forget(address, field);
    },
    onSuccess: () => void invalidate(),
  });
}

export function useMarkBackedUp() {
  const cmi = useCmi();
  const config = useConfig();
  const { address } = useWallet();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: async () => {
      if (cmi === null || address === null) throw new Error("wallet not connected");
      await cmi.keys.markBackedUp(address, addressToField(config.contracts.token));
    },
    onSuccess: () => void invalidate(),
  });
}

export function useBackupRequired(): boolean {
  const status = useAccountStatus();
  return status.data?.backupRequired === true;
}
