import {
  Account,
  Networks,
  SorobanDataBuilder,
  StrKey,
  rpc,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { RpcServer } from "../../src/index.js";

type SimResponse = rpc.Api.SimulateTransactionResponse;
type TxResponse = rpc.Api.GetTransactionResponse;

export function contractEvent(contractId: string, topics: xdr.ScVal[], data: xdr.ScVal): xdr.ContractEvent {
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: StrKey.decodeContract(contractId) as unknown as xdr.ContractId,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
  });
}

export function contractErrorEvent(contractId: string, code: number): xdr.DiagnosticEvent {
  const event = new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: StrKey.decodeContract(contractId) as unknown as xdr.ContractId,
    type: xdr.ContractEventType.diagnostic(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
        data: xdr.ScVal.scvString("escalating error to panic"),
      }),
    ),
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });
}

function txResult(result: xdr.TransactionResultResult, fee = 0n): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString(fee.toString()),
    result,
    ext: new xdr.TransactionResultExt(0),
  });
}

const BASE = { latestLedger: 100, latestLedgerCloseTime: 0, oldestLedger: 1, oldestLedgerCloseTime: 0 };

export class FakeRpc implements RpcServer {
  readonly calls: string[] = [];
  readonly sent: Transaction[] = [];
  readonly simulated: Transaction[] = [];
  passphrase: string = Networks.STANDALONE;
  latestLedger = 100;

  simulation: SimResponse = FakeRpc.simSuccess();
  sendStatus: rpc.Api.SendTransactionStatus = "PENDING";
  sendErrorResult: xdr.TransactionResult | undefined;

  transactions: TxResponse[] = [FakeRpc.txNotFound(), FakeRpc.txSuccess()];

  eventPages: rpc.Api.EventResponse[][] = [];

  eventCursors: string[] = [];

  accountMisses = 0;

  accountError: Error | undefined;

  static simSuccess(opts: { retval?: xdr.ScVal; cpu?: number; fee?: string } = {}): SimResponse {
    return {
      id: "1",
      latestLedger: 100,
      events: [],
      _parsed: true,
      transactionData: new SorobanDataBuilder().setResources(opts.cpu ?? 1_000, 0, 0),
      minResourceFee: opts.fee ?? "100",
      result: { auth: [], retval: opts.retval ?? xdr.ScVal.scvU32(0) },
    };
  }

  static simError(error: string, events: xdr.DiagnosticEvent[] = []): SimResponse {
    return { id: "1", latestLedger: 100, events, _parsed: true, error };
  }

  static txNotFound(): TxResponse {
    return { ...BASE, status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash: "" };
  }

  static txSuccess(
    opts: { ledger?: number; fee?: bigint; events?: xdr.ContractEvent[]; retval?: xdr.ScVal } = {},
  ): rpc.Api.GetSuccessfulTransactionResponse {
    return {
      ...BASE,
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      txHash: "",
      ledger: opts.ledger ?? 101,
      createdAt: 0,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: undefined as unknown as xdr.TransactionEnvelope,
      resultXdr: txResult(xdr.TransactionResultResult.txSuccess([]), opts.fee ?? 0n),
      resultMetaXdr: undefined as unknown as xdr.TransactionMeta,
      ...(opts.retval === undefined ? {} : { returnValue: opts.retval }),
      events: { transactionEventsXdr: [], contractEventsXdr: [opts.events ?? []] },
    };
  }

  static txFailed(
    opts: { diagnostics?: xdr.DiagnosticEvent[]; result?: xdr.TransactionResultResult } = {},
  ): rpc.Api.GetFailedTransactionResponse {
    const trapped = xdr.TransactionResultResult.txFailed([
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped()),
      ),
    ]);
    return {
      ...BASE,
      status: rpc.Api.GetTransactionStatus.FAILED,
      txHash: "",
      ledger: 101,
      createdAt: 0,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: undefined as unknown as xdr.TransactionEnvelope,
      resultXdr: txResult(opts.result ?? trapped),
      resultMetaXdr: undefined as unknown as xdr.TransactionMeta,
      diagnosticEventsXdr: opts.diagnostics ?? [],
      events: { transactionEventsXdr: [], contractEventsXdr: [] },
    };
  }

  static resourceLimitExceeded(): xdr.TransactionResultResult {
    return xdr.TransactionResultResult.txFailed([
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.invokeHostFunction(
          xdr.InvokeHostFunctionResult.invokeHostFunctionResourceLimitExceeded(),
        ),
      ),
    ]);
  }

  async getNetwork(): Promise<{ passphrase: string }> {
    this.calls.push("getNetwork");
    return { passphrase: this.passphrase };
  }

  async getAccount(address: string): Promise<Account> {
    this.calls.push("getAccount");
    if (this.accountMisses > 0) {
      this.accountMisses--;
      throw new Error(`Account not found: ${address}`);
    }
    if (this.accountError !== undefined) throw this.accountError;
    return new Account(address, "1");
  }

  async simulateTransaction(tx: Transaction | FeeBumpTransaction): Promise<SimResponse> {
    this.calls.push("simulateTransaction");
    this.simulated.push(tx as Transaction);
    return this.simulation;
  }

  async sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse> {
    this.calls.push("sendTransaction");
    this.sent.push(tx as Transaction);
    const hash = (tx as Transaction).hash().toString("hex");
    return {
      status: this.sendStatus,
      hash,
      latestLedger: this.latestLedger,
      latestLedgerCloseTime: 0,
      ...(this.sendErrorResult === undefined ? {} : { errorResult: this.sendErrorResult }),
    };
  }

  async getTransaction(hash: string): Promise<TxResponse> {
    this.calls.push("getTransaction");
    const next = this.transactions.length > 1 ? this.transactions.shift()! : this.transactions[0]!;
    return { ...next, txHash: hash };
  }

  async getLatestLedger(): Promise<{ sequence: number }> {
    this.calls.push("getLatestLedger");
    return { sequence: this.latestLedger };
  }

  readonly contractWasm = new Map<string, string>();

  async getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse> {
    this.calls.push("getLedgerEntries");
    const entries = keys.flatMap((key) => {
      const contract = StrKey.encodeContract(key.contractData().contract().contractId() as unknown as Buffer);
      const hash = this.contractWasm.get(contract);
      if (hash === undefined) return [];
      const val = xdr.LedgerEntryData.contractData(
        new xdr.ContractDataEntry({
          ext: new xdr.ExtensionPoint(0),
          contract: key.contractData().contract(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
          val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hash, "hex")), storage: null })),
        }),
      );
      return [{ key, val, lastModifiedLedgerSeq: 1, liveUntilLedgerSeq: 1_000_000 }];
    });
    return { entries, latestLedger: this.latestLedger } as rpc.Api.GetLedgerEntriesResponse;
  }

  oldestLedger = 0;

  readonly eventRequests: rpc.Api.GetEventsRequest[] = [];

  async getHealth(): Promise<rpc.Api.GetHealthResponse> {
    this.calls.push("getHealth");
    return { status: "healthy", latestLedger: this.latestLedger, oldestLedger: this.oldestLedger, ledgerRetentionWindow: this.latestLedger - this.oldestLedger };
  }

  async getEvents(req: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    this.calls.push(`getEvents:${req.cursor ?? `start=${req.startLedger}`}`);
    this.eventRequests.push(req);
    const page = this.eventPages.shift() ?? [];
    return {
      events: page,
      cursor: this.eventCursors.shift() ?? page.at(-1)?.id ?? "",
      latestLedger: this.latestLedger,
      oldestLedger: this.oldestLedger,
      latestLedgerCloseTime: "0",
      oldestLedgerCloseTime: "0",
    };
  }
}
