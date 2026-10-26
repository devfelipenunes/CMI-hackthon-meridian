import type { NetworkConfig } from "@/config/schema";

export interface PublicAccount {
  exists: boolean;

  xlm: bigint;
}

interface HorizonAccount {
  balances?: { asset_type: string; balance: string }[];
}

export async function fetchPublicAccount(address: string, config: NetworkConfig): Promise<PublicAccount> {
  const response = await fetch(`${config.horizonUrl}/accounts/${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return { exists: false, xlm: 0n };
  if (!response.ok) throw new Error(`Horizon responded ${response.status}`);
  const body = (await response.json()) as HorizonAccount;
  let xlm = 0n;
  for (const balance of body.balances ?? []) {
    if (balance.asset_type !== "native") continue;
    const [whole = "0", fraction = ""] = balance.balance.split(".");
    xlm = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0").slice(0, 7));
  }
  return { exists: true, xlm };
}

export async function fundWithFriendbot(address: string, config: NetworkConfig): Promise<void> {
  const response = await fetch(`${config.friendbotUrl}?addr=${encodeURIComponent(address)}`, { method: "GET" });
  if (!response.ok) throw new Error(`friendbot responded ${response.status}`);
}
