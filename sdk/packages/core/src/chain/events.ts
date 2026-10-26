import { StrKey, type rpc, type xdr } from "@stellar/stellar-sdk";

export type ContractId = string;
export type AccountId = string;

export interface ContractEvent {
  contractId: ContractId;
  topics: xdr.ScVal[];
  data: xdr.ScVal;

  id?: string;
  ledger?: number;
  txHash?: string;
}

export interface EventFilter {
  contractIds: ContractId[];

  topics?: string[][];
  startLedger: number;

  pageSize?: number;
}

export function fromTxEvent(e: xdr.ContractEvent): ContractEvent {
  const id = e.contractId();
  const body = e.body().v0();
  return {
    contractId: id === null ? "" : StrKey.encodeContract(id as unknown as Buffer),
    topics: body.topics(),
    data: body.data(),
  };
}

export function fromRpcEvent(e: rpc.Api.EventResponse): ContractEvent {
  return {
    contractId: e.contractId?.contractId() ?? "",
    topics: e.topic,
    data: e.value,
    id: e.id,
    ledger: e.ledger,
    txHash: e.txHash,
  };
}
