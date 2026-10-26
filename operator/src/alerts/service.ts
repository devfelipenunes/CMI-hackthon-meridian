import type { KeeperEvent } from "@zolvency-cmi/operator";
import type { Logger } from "pino";

import type { AlertRepo, Severity } from "../db/repos.js";

export type AlertKind =
  | "FinalizeFailed"
  | "ActionFailed"
  | "IntegrityMismatch"
  | "DeadlineNear"
  | "TimedOut"
  | "BidQuarantined"
  | "UnsupportedMarket"
  | "SubmitterLowBalance"
  | "RpcUnavailable"
  | "FeeWalletNotRegistered"
  | "FeeWalletMismatch"
  | "AuditorKeyMismatch"
  | "PocEnvelopeKey";

export interface AlertDraft {
  severity: Severity;
  kind: AlertKind;
  marketId: bigint | null;
  bidIndex: number | null;

  message: string;

  dedupKey?: string;
}

export const INTEGRITY_CODES: readonly string[] = ["RootMismatch", "OpeningMismatch", "CollateralMismatch"];

export type WebhookPost = (url: string, body: unknown) => Promise<void>;

const defaultPost: WebhookPost = async (url, body) => {
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
};

export class AlertService {
  readonly #repo: AlertRepo;
  readonly #log: Logger;
  readonly #webhook: string | null;
  readonly #post: WebhookPost;

  constructor(o: { repo: AlertRepo; logger: Logger; webhookUrl?: string | null; post?: WebhookPost }) {
    this.#repo = o.repo;
    this.#log = o.logger;
    this.#webhook = o.webhookUrl ?? null;
    this.#post = o.post ?? defaultPost;
  }

  raise(a: AlertDraft): boolean {
    const dedupKey = a.dedupKey ?? [a.kind, a.marketId ?? "-", a.bidIndex ?? "-"].join(":");
    const opened = this.#repo.open({ severity: a.severity, kind: a.kind, marketId: a.marketId, bidIndex: a.bidIndex, message: a.message, dedupKey });
    if (!opened) return false;
    const data = { alert: a.kind, marketId: a.marketId, bidIndex: a.bidIndex };
    if (a.severity === "critical") this.#log.error(data, a.message);
    else if (a.severity === "warning") this.#log.warn(data, a.message);
    else this.#log.info(data, a.message);
    if (this.#webhook !== null && a.severity !== "info") {
      const body = { severity: a.severity, kind: a.kind, marketId: a.marketId?.toString() ?? null, bidIndex: a.bidIndex, message: a.message, at: new Date().toISOString() };

      this.#post(this.#webhook, body).catch((e: unknown) => this.#log.warn({ err: e }, "alert webhook failed"));
    }
    return true;
  }

  fromKeeperEvents(marketId: bigint, events: readonly KeeperEvent[]): void {
    for (const e of events) {
      if (e.kind === "failed") {
        if (INTEGRITY_CODES.includes(e.code)) {
          this.raise({
            severity: "critical",
            kind: "IntegrityMismatch",
            marketId,
            bidIndex: null,
            message: `market ${marketId}: ${e.code} while reading the bids; no allocation proof is generated (RF-17). Investigate before the finalization deadline.`,
          });
        } else if (e.action === "finalize") {
          this.raise({ severity: "critical", kind: "FinalizeFailed", marketId, bidIndex: null, message: `market ${marketId}: finalize failed (${e.code}); retrying with backoff` });
        } else if (e.action === "close" || e.action === "cancel_expired") {
          this.raise({ severity: "warning", kind: "ActionFailed", marketId, bidIndex: null, message: `market ${marketId}: ${e.action} failed (${e.code}); retrying`, dedupKey: `ActionFailed:${marketId}:${e.action}` });
        }
      } else if (e.kind === "quarantined") {
        this.raise({
          severity: "critical",
          kind: "BidQuarantined",
          marketId,
          bidIndex: e.bidIndex,
          message: `market ${marketId}, bid ${e.bidIndex}: settlement failed repeatedly and the bid is quarantined; restart the service to retry it (OP-19)`,
        });
      } else if (e.kind === "action" && e.action.kind === "cancel_expired") {
        this.raise({
          severity: "critical",
          kind: "TimedOut",
          marketId,
          bidIndex: null,
          message: `market ${marketId}: not finalized before finalize_by_ledger; cancelled, every bid is refunded`,
        });
      }
    }
  }
}
