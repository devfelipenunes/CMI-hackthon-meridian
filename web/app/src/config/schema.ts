import { z } from "zod";

const contractId = z.string().regex(/^C[A-Z2-7]{55}$/, "invalid Stellar contract address");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "invalid lowercase SHA-256 hash");
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "registerData is not base64");

export const networkConfigSchema = z.object({
  network: z.literal("testnet"),
  rpcUrl: z.string().url(),
  horizonUrl: z.string().url(),
  friendbotUrl: z.string().url(),
  passphrase: z.string().min(1),
  deployedAtLedger: z.number().int().positive(),
  finalizationGraceLedgers: z.number().int().positive(),
  secondsPerLedger: z.number().int().positive(),
  contracts: z.object({
    factory: contractId,
    token: contractId,
    auditor: contractId,
    underlying: contractId,
  }),
  auctionWasmHash: sha256,
  registerData: base64.nullable(),
  operatorKeyId: z.string().min(1).nullable(),
  envelopeKeyIsTestConstant: z.boolean(),
});

export type NetworkConfig = z.infer<typeof networkConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

export function parseConfig(input: unknown): NetworkConfig {
  const result = networkConfigSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first === undefined ? "" : ` (${first.path.join(".")})`;
    throw new ConfigError(`Invalid network configuration${where}.`);
  }
  return result.data;
}

export async function loadConfig(url = "/config/testnet.json", fetchImpl: typeof fetch = fetch): Promise<NetworkConfig> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw new ConfigError("The network configuration could not be loaded.", { cause });
  }
  if (!response.ok) {
    throw new ConfigError(`The network configuration could not be loaded (HTTP ${response.status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ConfigError("The network configuration is not valid JSON.", { cause });
  }
  return parseConfig(body);
}
