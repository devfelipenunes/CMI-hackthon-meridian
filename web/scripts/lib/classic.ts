import {
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
  type Asset,
  type Keypair,
  type Transaction,
} from "@stellar/stellar-sdk";

import { step } from "./cli.js";

/** Conta clássica como o Horizon a mostra: flags do emissor e trustlines do holder. */
export interface HorizonAccount {
  id: string;
  sequence: string;
  flags: {
    auth_required?: boolean;
    auth_revocable?: boolean;
    auth_immutable?: boolean;
    clawback_enabled?: boolean;
  };
  balances: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }[];
}

export interface ClassicNetwork {
  horizonUrl: string;
  friendbotUrl: string;
  rpcUrl: string;
  passphrase: string;
}

export function rpcServer(network: ClassicNetwork): rpc.Server {
  return new rpc.Server(network.rpcUrl, { allowHttp: network.rpcUrl.startsWith("http://") });
}

export async function horizonAccount(network: ClassicNetwork, address: string): Promise<HorizonAccount | null> {
  const response = await fetch(`${network.horizonUrl}/accounts/${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Horizon respondeu ${response.status} ao ler ${address}`);
  return (await response.json()) as HorizonAccount;
}

/** O saldo do ativo clássico em unidades base (string de 7 casas), ou `null` sem trustline. */
export function trustlineBalance(account: HorizonAccount | null, asset: Asset): string | null {
  if (account === null) return null;
  const row = account.balances.find(
    (b) => b.asset_type !== "native" && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );
  return row?.balance ?? null;
}

/** Espera a conta aparecer no RPC depois do friendbot (a testnet às vezes demora). */
async function waitForAccount(server: rpc.Server, address: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const ok = await server.getAccount(address).then(
      () => true,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`a conta ${address} não apareceu na testnet depois do friendbot`);
}

export async function fund(network: ClassicNetwork, address: string): Promise<void> {
  const server = rpcServer(network);
  if (await server.getAccount(address).then(
    () => true,
    () => false,
  )) {
    step(`${address} já existe; friendbot não é necessário`);
    return;
  }

  const response = await fetch(`${network.friendbotUrl}?addr=${encodeURIComponent(address)}`);
  if (!response.ok) {
    // Um 400 do friendbot costuma ser "conta já financiada"; a conta existir é o que importa.
    const exists = await server.getAccount(address).then(
      () => true,
      () => false,
    );
    if (!exists) throw new Error(`friendbot respondeu ${response.status}`);
    step(`${address} já estava financiada`);
    return;
  }
  step(`friendbot financiou ${address}`);
  await waitForAccount(server, address);
}

async function submit(server: rpc.Server, tx: Transaction): Promise<string> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    throw new Error(`transação clássica recusada (${sent.status})`);
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transação clássica falhou: ${sent.hash}`);
  }
  throw new Error(`transação clássica sem confirmação: ${sent.hash}`);
}

/** Monta, assina e espera uma transação clássica de uma fonte só. */
export async function classic(
  network: ClassicNetwork,
  source: Keypair,
  operations: ReturnType<typeof Operation.payment>[],
): Promise<string> {
  const server = rpcServer(network);
  const account = await server.getAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: network.passphrase }).setTimeout(60);
  for (const op of operations) builder.addOperation(op);
  const tx = builder.build();
  tx.sign(source);
  return submit(server, tx);
}

export async function addTrustline(network: ClassicNetwork, holder: Keypair, asset: Asset): Promise<void> {
  await classic(network, holder, [Operation.changeTrust({ asset })]);
  step(`trustline de ${asset.getCode()} aberta para ${holder.publicKey()}`);
}

export async function pay(
  network: ClassicNetwork,
  issuer: Keypair,
  destination: string,
  asset: Asset,
  amount: string,
): Promise<void> {
  await classic(network, issuer, [Operation.payment({ destination, asset, amount })]);
  step(`${amount} ${asset.getCode()} enviados a ${destination}`);
}

/** O SAC do ativo; se ainda não existe, implanta e espera confirmar. */
export async function deploySac(network: ClassicNetwork, issuer: Keypair, asset: Asset): Promise<string> {
  const server = rpcServer(network);
  const address = asset.contractId(network.passphrase);
  const account = await server.getAccount(issuer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: network.passphrase })
    .addOperation(Operation.createStellarAssetContract({ asset }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(issuer);
  await submit(server, prepared);
  step(`SAC implantado em ${address}`);
  return address;
}
