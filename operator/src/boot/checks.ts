import { BID_VALIDITY_PK_OPERATOR, GRUMPKIN_G, scalarMul } from "@zolvency-cmi/core";

import type { AlertDraft } from "../alerts/service.js";
import type { ChainPorts } from "../chain/ports.js";
import type { Deployment } from "../config/load.js";
import { errorCode } from "../errors.js";
import { POC_ENVELOPE_SCALAR, auditorKeyHex, samePoint, type DbOperatorKeyStore } from "../keys/store.js";

export interface BootReport {

  fatal: string[];

  warnings: AlertDraft[];
  envelopeKey: "poc" | "custom" | null;
  feeWalletRegistered: boolean | null;
  submitter: { address: string; xlmStroops: bigint | null } | null;
}

const warn = (kind: AlertDraft["kind"], message: string): AlertDraft => ({ severity: "warning", kind, marketId: null, bidIndex: null, message });

export async function bootChecks(d: { ports: ChainPorts; keys: DbOperatorKeyStore; deployment: Deployment; minSubmitterStroops: bigint }): Promise<BootReport> {
  const r: BootReport = { fatal: [], warnings: [], envelopeKey: null, feeWalletRegistered: null, submitter: null };

  for (const name of ["spender", "envelope", "submitter"] as const) {
    if (!d.keys.has(name)) r.fatal.push(`key "${name}" not found (pnpm cli keys ${name === "envelope" ? "import envelope --poc" : `generate ${name}`})`);
  }

  try {
    await d.ports.assertNetwork();
  } catch (e) {
    r.fatal.push(`network check failed (${errorCode(e)}): the RPC is not on the deployment's network`);
  }
  if (r.fatal.length > 0) return r;

  try {
    const env = (await d.keys.envelopeKey()).expose();
    if (!samePoint(scalarMul(env, GRUMPKIN_G), BID_VALIDITY_PK_OPERATOR)) r.fatal.push("EnvelopeKeyMismatch: the envelope key does not match the PK_operator of the bid_validity circuit");
    r.envelopeKey = env === POC_ENVELOPE_SCALAR ? "poc" : "custom";
    if (r.envelopeKey === "poc") {
      r.warnings.push({ ...warn("PocEnvelopeKey", "the envelope key is the public POC key (OP-10): bid prices are readable by anyone; test use only"), severity: "info" });
    }
    if (auditorKeyHex((await d.keys.spenderKey()).expose()) !== d.deployment.auditor.key) {
      r.warnings.push(warn("AuditorKeyMismatch", "the token auditor key of this deployment is not sk_op·H (D3); the operator flows do not depend on it"));
    }
  } catch (e) {
    r.fatal.push(`keys cannot be read (${errorCode(e)})`);
    return r;
  }

  try {
    r.feeWalletRegistered = (await d.ports.token.account(d.deployment.feeWallet)) !== null;
    if (!r.feeWalletRegistered) {
      r.warnings.push(warn("FeeWalletNotRegistered", `the fee wallet ${d.deployment.feeWallet} has no Confidential Token account: no market can be created (pnpm cli bootstrap fee-wallet)`));
    }
  } catch (e) {
    r.warnings.push(warn("FeeWalletNotRegistered", `the fee wallet account could not be read (${errorCode(e)})`));
  }
  if (d.keys.has("fee_wallet_stellar") && d.keys.publicOf("fee_wallet_stellar") !== d.deployment.feeWallet) {
    r.warnings.push(warn("FeeWalletMismatch", "the fee_wallet_stellar key is not the fee wallet of this deployment"));
  }

  const submitter = d.keys.publicOf("submitter");
  try {
    const xlm = await d.ports.xlmBalance(submitter);
    r.submitter = { address: submitter, xlmStroops: xlm };
    if (xlm === null) r.warnings.push(warn("SubmitterLowBalance", `the submitter ${submitter} does not exist on the network: fund it (pnpm cli bootstrap fund submitter)`));
    else if (xlm < d.minSubmitterStroops) r.warnings.push(warn("SubmitterLowBalance", `the submitter ${submitter} has a low XLM balance`));
  } catch (e) {
    r.submitter = { address: submitter, xlmStroops: null };
    r.warnings.push(warn("SubmitterLowBalance", `the submitter balance could not be read (${errorCode(e)})`));
  }
  return r;
}
