import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { keypairSigner, type WalletAdapter } from "@zolvency-cmi/core";

export function initWalletKit(passphrase: string): void {
  if (passphrase !== Networks.TESTNET) throw new Error("network passphrase is not testnet");
  StellarWalletsKit.init({ modules: [new FreighterModule()], network: Networks.TESTNET });
  StellarWalletsKit.setWallet(FREIGHTER_ID);
}

export const isFreighterAvailable = async (): Promise<boolean> => new FreighterModule().isAvailable();

export async function connectFreighter(passphrase: string): Promise<WalletAdapter> {
  initWalletKit(passphrase);
  const { address } = await StellarWalletsKit.fetchAddress();
  const network = await StellarWalletsKit.getNetwork();
  if (network.networkPassphrase !== passphrase) {
    throw new Error("the wallet network passphrase does not match the app");
  }
  return {
    address,
    async signTransaction(xdr, opts) {
      return StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: opts.networkPassphrase,
        address: opts.address,
      });
    },
  };
}

export function connectDevWallet(secret: string): WalletAdapter {
  const signer = keypairSigner(secret.trim());
  return {
    address: signer.address,
    signTransaction: async (xdr, opts) => ({ signedTxXdr: await signer.signTransaction(xdr, { networkPassphrase: opts.networkPassphrase }) }),
  };
}

export async function disconnectWallet(): Promise<void> {
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    return;
  }
}
