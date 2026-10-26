import { fileURLToPath } from "node:url";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Caminhos do repositório, resolvidos a partir deste arquivo (nunca do cwd). */
export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const sdkRoot = join(repoRoot, "sdk");
export const contractsRoot = join(sdkRoot, "contracts");
export const appConfigPath = join(repoRoot, "app/public/config/testnet.json");
export const envLocalPath = join(repoRoot, ".env.local");
export const dotEnvExamplePath = join(repoRoot, ".env.example");
export const localDir = join(repoRoot, ".local");
export const tokensPath = join(localDir, "tokens.json");
export const devSourcesPath = join(sdkRoot, "packages/artifacts/dev-sources.json");
export const localDeploymentPath = join(contractsRoot, "deployments/local.json");

/** `.local/` é estado de desenvolvimento (ignorado pelo git); criado só quando há o que gravar. */
export function ensureLocalDir(): void {
  mkdirSync(localDir, { recursive: true, mode: 0o700 });
}
