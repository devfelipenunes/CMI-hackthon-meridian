import { ChainClient, type CallOptions, type ContractId, type Signer, type TxResult } from "@zolvency-cmi/core";
import type { xdr } from "@stellar/stellar-sdk";

export interface RecordedTx {
  contract: ContractId;
  method: string;
  signer: string;
  hash: string;
  cpuInsns: number;
}

export class RecordingChain extends ChainClient {
  readonly txs: RecordedTx[] = [];

  override async invoke(contract: ContractId, method: string, args: xdr.ScVal[], signer: Signer, opts?: CallOptions): Promise<TxResult> {
    const r = await super.invoke(contract, method, args, signer, opts);
    this.txs.push({ contract, method, signer: signer.address, hash: r.hash, cpuInsns: r.cpuInsns });
    return r;
  }

  last(method: string, signer?: string): RecordedTx {
    const t = [...this.txs].reverse().find((x) => x.method === method && (signer === undefined || x.signer === signer));
    if (t === undefined) throw new Error(`no ${method} transaction recorded`);
    return t;
  }

  countBy(signer: string): number {
    return this.txs.filter((t) => t.signer === signer).length;
  }
}
