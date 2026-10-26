import { Asset, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { WalletAdapter } from "@zolvency-cmi/core";

export interface SacAsset {
  code: string;
  issuer: string;

  label: string;
}

export function parseSacName(name: string): SacAsset {
  const index = name.indexOf(":");
  if (index <= 0 || index === name.length - 1) throw new Error("the SAC did not return CODE:ISSUER from name()");
  const code = name.slice(0, index);
  const issuer = name.slice(index + 1);
  return { code, issuer, label: name };
}

export async function addTrustline(wallet: WalletAdapter, asset: SacAsset, horizonUrl: string, passphrase: string): Promise<string> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(wallet.address);
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset(asset.code, asset.issuer) }))
    .setTimeout(60)
    .build();
  const { signedTxXdr } = await wallet.signTransaction(tx.toXDR(), { networkPassphrase: passphrase, address: wallet.address });
  const result = await server.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, passphrase));
  return result.hash;
}
