import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  type FeeBumpTransaction,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";

import { CmiError } from "../errors/CmiError.js";
import type { ContractErrorDomain } from "../errors/maps.js";
import { onChainError, sendError, simulationError } from "./errors.js";
import { fromRpcEvent, fromTxEvent, type ContractEvent, type ContractId, type EventFilter } from "./events.js";
import type { Signer } from "./signer.js";

export interface RpcServer {
  getNetwork(): Promise<{ passphrase: string }>;
  getAccount(address: string): Promise<Account>;
  simulateTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SimulateTransactionResponse>;
  sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
  getLatestLedger(): Promise<{ sequence: number }>;

  getHealth?(): Promise<rpc.Api.GetHealthResponse>;
  getEvents(req: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse>;
}

export interface ChainClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
  allowHttp?: boolean;

  server?: RpcServer;

  pollIntervalMs?: number;

  maxPolls?: number;
}

export interface CallOptions {

  errors?: ContractErrorDomain;
}

export interface TxResult {
  hash: string;
  ledger: number;
  events: ContractEvent[];

  cpuInsns: number;

  feeCharged: bigint;
  returnValue?: xdr.ScVal;
}

const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const MAX_TOPICS_PER_FILTER = 5;

export const EVENT_WINDOW_MARGIN_LEDGERS = 60;

export class ChainClient {
  readonly networkPassphrase: string;
  readonly #server: RpcServer;
  readonly #pollMs: number;
  readonly #maxPolls: number;
  #network: Promise<void> | undefined;

  constructor(cfg: ChainClientConfig) {
    this.networkPassphrase = cfg.networkPassphrase;
    this.#server = cfg.server ?? new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.allowHttp ?? cfg.rpcUrl.startsWith("http://") });
    this.#pollMs = cfg.pollIntervalMs ?? 1_000;
    this.#maxPolls = cfg.maxPolls ?? 60;
  }

  assertNetwork(): Promise<void> {
    this.#network ??= this.#server.getNetwork().then(({ passphrase }) => {
      if (passphrase !== this.networkPassphrase) {
        throw new CmiError("NetworkMismatch", "the RPC is on a different network than the configured passphrase");
      }
    });

    this.#network.catch(() => {
      this.#network = undefined;
    });
    return this.#network;
  }

  #build(source: Account, contract: ContractId, method: string, args: xdr.ScVal[], timeout: number): Transaction {
    return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(timeout)
      .build();
  }

  async simulate(contract: ContractId, method: string, args: xdr.ScVal[], opts: CallOptions = {}): Promise<xdr.ScVal> {
    await this.assertNetwork();
    const tx = this.#build(new Account(NULL_ACCOUNT, "0"), contract, method, args, 30);
    const sim = await this.#server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw simulationError(method, sim.error, sim.events, opts.errors);
    if (sim.result === undefined) throw new CmiError("TxFailed", `${method}: simulation returned no result`);
    return sim.result.retval;
  }

  async invoke(contract: ContractId, method: string, args: xdr.ScVal[], signer: Signer, opts: CallOptions = {}): Promise<TxResult> {
    await this.assertNetwork();
    const source = await this.#sourceAccount(signer.address);
    const tx = this.#build(source, contract, method, args, 180);

    const sim = await this.#server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw simulationError(method, sim.error, sim.events, opts.errors);
    const cpuInsns = sim.transactionData.build().resources().instructions();
    const assembled = rpc.assembleTransaction(tx, sim).build();

    const signedXdr = await signer.signTransaction(assembled.toXDR(), { networkPassphrase: this.networkPassphrase });
    const signed = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);

    const send = await this.#server.sendTransaction(signed);
    if (send.status === "ERROR" || send.status === "TRY_AGAIN_LATER") throw sendError(method, send.status, send.errorResult);

    for (let i = 0; i < this.#maxPolls; i++) {
      await sleep(this.#pollMs);
      const res = await this.#server.getTransaction(send.hash);
      if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw onChainError(method, send.hash, res.resultXdr, res.diagnosticEventsXdr ?? [], opts.errors);
      }
      return {
        hash: send.hash,
        ledger: res.ledger,
        events: res.events.contractEventsXdr.flat().map(fromTxEvent),
        cpuInsns,
        feeCharged: BigInt(res.resultXdr.feeCharged().toString()),
        ...(res.returnValue === undefined ? {} : { returnValue: res.returnValue }),
      };
    }
    throw new CmiError("TxFailed", `${method}: confirmation timed out (tx ${send.hash})`);
  }

  async #sourceAccount(address: string): Promise<Account> {
    for (let i = 1; ; i++) {
      try {
        return await this.#server.getAccount(address);
      } catch (e) {
        if (i >= this.#maxPolls || !(e instanceof Error) || !e.message.startsWith("Account not found")) throw e;
        await sleep(this.#pollMs);
      }
    }
  }

  async contractWasmHash(contract: ContractId): Promise<string> {
    const key = new Contract(contract).getFootprint();
    const { entries } = await this.#server.getLedgerEntries(key);
    const instance = entries[0]?.val.contractData().val().instance();
    if (instance === undefined) throw new CmiError("TxFailed", "contract instance not found on the network");
    return Buffer.from(instance.executable().wasmHash()).toString("hex");
  }

  async latestLedger(): Promise<number> {
    return (await this.#server.getLatestLedger()).sequence;
  }

  async oldestEventLedger(): Promise<number> {
    return (await this.#server.getHealth?.())?.oldestLedger ?? 0;
  }

  async eventStart(startLedger: number): Promise<number> {
    const floor = await this.oldestEventLedger();
    return floor === 0 ? startLedger : Math.max(startLedger, floor + EVENT_WINDOW_MARGIN_LEDGERS);
  }

  async *events(filter: EventFilter): AsyncIterable<ContractEvent> {
    const limit = filter.pageSize ?? 100;
    const chunks: (string[][] | undefined)[] = [];
    if (filter.topics === undefined) chunks.push(undefined);
    else for (let i = 0; i < filter.topics.length; i += MAX_TOPICS_PER_FILTER) chunks.push(filter.topics.slice(i, i + MAX_TOPICS_PER_FILTER));
    const filters: rpc.Api.EventFilter[] = chunks.map((topics) => ({ type: "contract", contractIds: filter.contractIds, ...(topics === undefined ? {} : { topics }) }));
    let page = await this.#server.getEvents({ filters, startLedger: await this.eventStart(filter.startLedger), limit });
    for (;;) {
      for (const e of page.events) yield fromRpcEvent(e);

      if (page.events.length < limit) {
        const at = cursorLedger(page.cursor);
        if (at === null || at >= page.latestLedger) return;
      }
      page = await this.#server.getEvents({ filters, cursor: page.cursor, limit });
    }
  }
}

function cursorLedger(cursor: string): number | null {
  const m = /^(\d+)-\d+$/.exec(cursor);
  return m === null ? null : Number(BigInt(m[1]!) >> 32n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
