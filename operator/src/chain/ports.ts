import type { AuctionPort, FactoryPort, TokenPort } from "@zolvency-cmi/core";

export interface RecordedTx {
  contract: string;
  method: string;
  hash: string;
  ledger: number;
  feeCharged: bigint;
  cpuInsns: number;
}

export class TxSink {
  #txs: RecordedTx[] = [];

  push(tx: RecordedTx): void {
    this.#txs.push(tx);
  }

  drain(): RecordedTx[] {
    const out = this.#txs;
    this.#txs = [];
    return out;
  }
}

export interface ChainPorts {
  latestLedger(): Promise<number>;

  assertNetwork(): Promise<void>;
  factory: FactoryPort;
  auction(address: string): AuctionPort;
  token: TokenPort;

  versionOf(address: string): Promise<string>;

  xlmBalance(account: string): Promise<bigint | null>;
  txSink: TxSink;
}
