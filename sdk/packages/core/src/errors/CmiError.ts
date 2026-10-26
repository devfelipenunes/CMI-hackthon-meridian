import type { CmiErrorCode } from "./codes.js";

export type { CmiErrorCode };

export type CmiRecovery = "revoke_spender" | "retry_next_ledger" | "refresh_and_retry" | "change_trust";

export class CmiError extends Error {
  readonly code: CmiErrorCode;
  readonly recovery: CmiRecovery | undefined;

  constructor(code: CmiErrorCode, message: string, opts: { recovery?: CmiRecovery; cause?: unknown } = {}) {
    super(`${code}: ${message}`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "CmiError";
    this.code = code;
    this.recovery = opts.recovery;
  }
}
