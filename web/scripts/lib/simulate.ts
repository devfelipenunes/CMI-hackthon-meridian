import { BASE_FEE, Contract, TransactionBuilder, contract, rpc } from "@stellar/stellar-sdk";
import { ChainClient, MIN_FEE_RESERVE, chainFactoryPort, chainTokenPort } from "@zolvency-cmi/core";

import type { NetworkConfig } from "../../app/src/config/schema.js";
// A spec do Factory é gerada dos contratos (src/bindings) e não é exportada pelo pacote; os
// scripts leem o arquivo gerado direto, sem copiar a spec para o front.
import { FACTORY_SPEC } from "../../sdk/packages/core/src/bindings/factory.js";
import { fail, step } from "./cli.js";

const spec = new contract.Spec([...FACTORY_SPEC]);

/**
 * Simula `create_market` com o `register_data` — sem assinar, enviar ou gravar nada. É a
 * verificação do passo 1.2: a Factory e o registro do token aceitam a prova.
 *
 * O seller da simulação é a `fee_wallet` da plataforma: é uma conta que o deploy já registrou
 * no token e tem XLM. Nenhum mercado é criado; a simulação não altera o ledger.
 */
export async function simulateCreateMarket(config: NetworkConfig, registerData: Uint8Array, seller?: string): Promise<void> {
  const chain = new ChainClient({ rpcUrl: config.rpcUrl, networkPassphrase: config.passphrase });
  const platform = await chainFactoryPort({ chain, address: config.contracts.factory }).getPlatformConfig();
  const actualSeller = seller ?? platform.feeWallet;

  const token = chainTokenPort({ chain, token: config.contracts.token, auditor: config.contracts.auditor });
  if ((await token.account(actualSeller)) === null) {
    fail(`a conta ${actualSeller} (fee_wallet) não está registrada no token; o deploy está completo?`);
  }

  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const source = await server.getAccount(actualSeller).catch(() => {
    throw new Error(`a conta ${actualSeller} não existe na testnet; o deployment está completo?`);
  });
  const latest = (await server.getLatestLedger()).sequence;

  const args = spec.funcArgsToScVals("create_market", {
    seller: actualSeller,
    params: {
      quota_asset: config.contracts.underlying,
      total_quotas: 100,
      min_price_per_quota: 1_000_000n,
      close_ledger: latest + 1_000,
      eligibility_policy: undefined,
      fee_reserve: MIN_FEE_RESERVE,
    },
    register_data: Buffer.from(registerData),
  });

  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: config.passphrase })
    .addOperation(new Contract(config.contracts.factory).call("create_market", ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    return fail(`create_market recusou o register_data: ${sim.error}`);
  }
  if (sim.result === undefined) fail("a simulação de create_market não devolveu resultado");
  step("create_market aceita o register_data (simulação, nada enviado)");
}
