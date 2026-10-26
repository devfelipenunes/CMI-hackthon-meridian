import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";

import { fundAccount, testNetwork } from "./localnet.js";

export interface QuotaAsset {
  asset: Asset;

  sac: string;
  issuer: Keypair;
}

const server = (): rpc.Server => new rpc.Server(testNetwork().rpcUrl, { allowHttp: testNetwork().rpcUrl.startsWith("http://") });

async function submit(tx: Transaction | FeeBumpTransaction): Promise<void> {
  const s = server();
  const sent = await s.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`classic tx rejected: ${sent.status}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await s.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`classic tx failed: ${sent.hash}`);
  }
  throw new Error(`classic tx timed out: ${sent.hash}`);
}

async function classic(source: Keypair, ops: ReturnType<typeof Operation.payment>[]): Promise<void> {
  const account = await server().getAccount(source.publicKey());
  const b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: testNetwork().networkPassphrase }).setTimeout(60);
  for (const op of ops) b.addOperation(op);
  const tx = b.build();
  tx.sign(source);
  await submit(tx);
}

export async function addTrustline(holder: Keypair, asset: Asset): Promise<void> {
  await classic(holder, [Operation.changeTrust({ asset })]);
}

export async function issueQuotaAsset(o: { code?: string; holders: { kp: Keypair; quotas: number }[] }): Promise<QuotaAsset> {
  const issuer = Keypair.random();
  await fundAccount(issuer.publicKey());
  const asset = new Asset(o.code ?? "QUOTA", issuer.publicKey());

  for (const h of o.holders) await addTrustline(h.kp, asset);
  if (o.holders.length > 0) {
    await classic(
      issuer,
      o.holders.map((h) => Operation.payment({ destination: h.kp.publicKey(), asset, amount: String(h.quotas) })),
    );
  }

  const s = server();
  const account = await s.getAccount(issuer.publicKey());
  const deploy = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: testNetwork().networkPassphrase })
    .addOperation(Operation.createStellarAssetContract({ asset }))
    .setTimeout(60)
    .build();
  const prepared = await s.prepareTransaction(deploy);
  prepared.sign(issuer);
  await submit(prepared);

  return { asset, sac: asset.contractId(testNetwork().networkPassphrase), issuer };
}
