import { createHash } from "node:crypto";

export const RC1_CHECKS = [
  "RF-08.auction_registers_in_real_token",
  "RF-09.lock_real_set_spender",
  "RF-11.submit_bid_real_ca_accepted",
  "RF-14.ca_of_other_value_rejected",
  "RF-14.short_live_until_rejected",
  "RF-09.revocation_detected",
  "RF-09.second_set_spender_fails_with_clear_sdk_error",
  "RF-11.below_min_creates_no_delegation",
  "RF-09.rejected_after_lock_revoke_returns_funds",
] as const;

export const RC2_CHECKS = [
  "RF-20.settle_partial",
  "RF-20.settle_full",
  "RF-20.settle_zero",
  "RF-20.fee_skipped_rejected",
  "RF-20.fee_20pct_rejected",
  "RF-20.leg_rollback",
  "RF-20.release_after_real_revocation",
  "RF-20.settle_cpu_under_400m",
] as const;

export const RC3_CHECKS = ["MVP.full_auction_8_bids_settled", "MVP.timeout_refunds"] as const;

export type Round = "rc1" | "rc2" | "rc3" | "all";

export const ROUND_CHECKS: Record<Round, readonly string[]> = {
  rc1: RC1_CHECKS,
  rc2: RC2_CHECKS,
  rc3: RC3_CHECKS,
  all: [...RC1_CHECKS, ...RC2_CHECKS, ...RC3_CHECKS],
};

export const ROUND_VKS = {
  rc1: ["bid_validity"],
  rc2: ["bid_validity", "winner_allocation", "settlement_binding"],
  rc3: ["bid_validity", "winner_allocation", "settlement_binding"],
  all: ["bid_validity", "winner_allocation", "settlement_binding"],
} as const satisfies Record<Round, readonly string[]>;

export function roundOf(tag: string): Round {
  const m = /-rc\.(\d+)$/.exec(tag);

  const r = m === null ? undefined : Number(m[1]) >= 4 ? "all" : (`rc${m[1]}` as Round);
  if (r === undefined || !(r in ROUND_CHECKS)) throw new Error(`a tag ${tag} não diz a rodada do E2E: use --round rc1|rc2|rc3|all`);
  return r;
}

export interface CheckOutcome {
  id: string;
  result: "PASS" | "FAIL";
  tx?: string;
  cpu?: number;

  error?: string;
}

export interface Evidence {
  contracts_tag: string;
  contracts_commit: string;
  sdk_commit: string;
  network: "quickstart-local" | "testnet";
  run_at: string;
  wasm_sha256: Record<string, string>;
  vk_sha256: Record<string, string>;
  checks: CheckOutcome[];
  summary: { pass: number; fail: number };
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function errorCode(e: string): string {
  const m = /\b((?:Auction|Factory|Token)\.\w+|[A-Z][A-Za-z]+(?=:|$))/.exec(e.replace(/^CmiError:\s*/, ""));
  return m?.[1] ?? "Error";
}

function clean(c: CheckOutcome): CheckOutcome {
  return {
    id: c.id,
    result: c.result,
    ...(c.tx === undefined ? {} : { tx: c.tx }),
    ...(c.cpu === undefined ? {} : { cpu: c.cpu }),
    ...(c.error === undefined ? {} : { error: errorCode(c.error) }),
  };
}

export function buildEvidence(o: {
  contractsTag: string;
  contractsCommit: string;
  sdkCommit: string;
  network: Evidence["network"];
  runAt: Date;
  wasm: ReadonlyMap<string, Uint8Array>;
  vks: ReadonlyMap<string, Uint8Array>;
  checks: readonly CheckOutcome[];
}): Evidence {
  const checks = o.checks.map(clean);
  return {
    contracts_tag: o.contractsTag,
    contracts_commit: o.contractsCommit,
    sdk_commit: o.sdkCommit,
    network: o.network,
    run_at: o.runAt.toISOString(),
    wasm_sha256: Object.fromEntries([...o.wasm].map(([k, v]) => [k, sha256(v)])),
    vk_sha256: Object.fromEntries([...o.vks].map(([k, v]) => [k, sha256(v)])),
    checks,
    summary: { pass: checks.filter((c) => c.result === "PASS").length, fail: checks.filter((c) => c.result === "FAIL").length },
  };
}
