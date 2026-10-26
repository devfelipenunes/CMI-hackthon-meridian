import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import type { AccountId } from "./events.js";

export interface Signer {
  address: AccountId;

  signTransaction(xdr: string, opts: { networkPassphrase: string }): Promise<string>;
  signAuthEntry?(entry: string, opts: { networkPassphrase: string }): Promise<string>;
}

export interface WalletAdapter {
  address: AccountId;
  signTransaction(xdr: string, opts: { networkPassphrase: string; address: AccountId }): Promise<{ signedTxXdr: string }>;
  signAuthEntry?(entry: string, opts: { networkPassphrase: string; address: AccountId }): Promise<{ signedAuthEntry: string }>;
}

export function keypairSigner(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    address: kp.publicKey(),
    async signTransaction(xdr, { networkPassphrase }) {
      const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}

export function walletSigner(wallet: WalletAdapter): Signer {
  const signer: Signer = {
    address: wallet.address,
    async signTransaction(xdr, { networkPassphrase }) {
      return (await wallet.signTransaction(xdr, { networkPassphrase, address: wallet.address })).signedTxXdr;
    },
  };
  if (wallet.signAuthEntry !== undefined) {
    const sign = wallet.signAuthEntry.bind(wallet);
    signer.signAuthEntry = async (entry, { networkPassphrase }) =>
      (await sign(entry, { networkPassphrase, address: wallet.address })).signedAuthEntry;
  }
  return signer;
}
