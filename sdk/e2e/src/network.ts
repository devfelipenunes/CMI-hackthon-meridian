import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { LOCALNET, TESTNET, type TestNetwork } from "@zolvency-cmi/testing";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

export interface E2eNetwork {
  name: "local" | "testnet";

  label: "quickstart-local" | "testnet";

  deployment: string;
  test: TestNetwork;
}

export function networkOf(name: string): E2eNetwork {
  if (name === "local") return { name, label: "quickstart-local", deployment: join(REPO, "deployments/local.json"), test: LOCALNET };
  if (name === "testnet") return { name, label: "testnet", deployment: join(REPO, "contracts/deployments/testnet.json"), test: TESTNET };
  throw new Error(`rede desconhecida: ${name} (use local ou testnet)`);
}

export function evidenceFile(tag: string, net: E2eNetwork, contractsCommit: string, round?: string): string {
  const suffix = net.name === "testnet" ? "-testnet" : "";
  return tag === "dev" ? `dev-${round ?? "all"}-${contractsCommit.slice(0, 7)}${suffix}.json` : `${tag}${suffix}.json`;
}
