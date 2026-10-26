import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { loadArtifacts, loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import {
  ChainClient,
  chainAuctionPort,
  chainFactoryPort,
  chainTokenPort,
  createProver,
  marketVersion,
  type AuctionPort,
  type Prover,
  type TxResult,
} from "@zolvency-cmi/core";

import type { ServiceConfig } from "../config/load.js";
import { TxSink, type ChainPorts } from "./ports.js";

export function recordingChain(chain: ChainClient, sink: TxSink): ChainClient {
  return new Proxy(chain, {
    get(target, prop) {
      if (prop === "invoke") {
        return async (...args: Parameters<ChainClient["invoke"]>): Promise<TxResult> => {
          const r = await target.invoke(...args);
          sink.push({ contract: args[0], method: args[1], hash: r.hash, ledger: r.ledger, feeCharged: r.feeCharged, cpuInsns: r.cpuInsns });
          return r;
        };
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export function connectChain(cfg: ServiceConfig): ChainPorts {
  const { deployment } = cfg;
  const allowHttp = deployment.rpcUrl.startsWith("http://");
  const sink = new TxSink();
  const raw = new ChainClient({ rpcUrl: deployment.rpcUrl, networkPassphrase: deployment.networkPassphrase, allowHttp });
  const chain = recordingChain(raw, sink);
  const server = new rpc.Server(deployment.rpcUrl, { allowHttp });
  const auctions = new Map<string, AuctionPort>();
  return {
    latestLedger: () => chain.latestLedger(),
    assertNetwork: () => chain.assertNetwork(),
    factory: chainFactoryPort({ chain, address: deployment.contracts.factory }),
    auction(address) {
      let a = auctions.get(address);
      if (a === undefined) {
        a = chainAuctionPort({ chain, address });
        auctions.set(address, a);
      }
      return a;
    },
    token: chainTokenPort({ chain, token: deployment.contracts.token, auditor: deployment.contracts.auditor }),
    versionOf: async (address) => (await marketVersion(chain, address)).auctionWasmSha256,
    async xlmBalance(account) {
      const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(account).xdrPublicKey() }));
      const { entries } = await server.getLedgerEntries(key);
      const entry = entries[0];
      return entry === undefined ? null : BigInt(entry.val.account().balance().toString());
    },
    txSink: sink,
  };
}

export function connectProver(cfg: ServiceConfig): Prover {
  const artifacts = cfg.release === null ? loadDevArtifacts() : loadArtifacts({ release: cfg.release });
  return createProver({ artifacts });
}
