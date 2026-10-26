import { xdr } from "@stellar/stellar-sdk";

import { CmiError } from "../errors/CmiError.js";
import { contractErrorCode, type ContractErrorDomain } from "../errors/maps.js";

const HOST_ERROR = /Error\((\w+), ?#?(\w+)\)/;

function codeFromDiagnostics(events: readonly xdr.DiagnosticEvent[]): number | null {
  let code: number | null = null;
  for (const d of events) {
    for (const t of d.event().body().v0().topics()) {
      if (t.switch() !== xdr.ScValType.scvError()) continue;
      const err = t.error();
      if (err.switch() === xdr.ScErrorType.sceContract()) code = err.contractCode();
    }
  }
  return code;
}

function fromCode(method: string, code: number, domain: ContractErrorDomain | undefined): CmiError {
  const mapped = contractErrorCode(code, domain);
  return mapped === null
    ? new CmiError("TxFailed", `${method}: Error(Contract, #${code})`)
    : new CmiError(mapped, `${method}: Error(Contract, #${code})`);
}

export function simulationError(
  method: string,
  text: string,
  events: readonly xdr.DiagnosticEvent[],
  domain: ContractErrorDomain | undefined,
): CmiError {
  const code = codeFromDiagnostics(events);
  if (code !== null) return fromCode(method, code, domain);
  const m = HOST_ERROR.exec(text);
  if (m === null) return new CmiError("TxFailed", `${method}: simulation failed`);
  if (m[1] === "Contract") return fromCode(method, Number(m[2]), domain);
  return new CmiError("TxFailed", `${method}: Error(${m[1]}, ${m[2]})`);
}

const contention = (method: string, why: string): CmiError =>
  new CmiError("ResourceContention", `${method}: ${why}`, { recovery: "retry_next_ledger" });

function isContention(result: xdr.TransactionResult | undefined): boolean {
  if (result === undefined) return false;
  const r = result.result();
  if (r.switch() === xdr.TransactionResultCode.txInsufficientFee()) return true;
  if (r.switch() !== xdr.TransactionResultCode.txFailed()) return false;
  return r.results().some((op) => {
    if (op.switch() !== xdr.OperationResultCode.opInner()) return false;
    const tr = op.tr();
    return (
      tr.switch() === xdr.OperationType.invokeHostFunction() &&
      tr.invokeHostFunctionResult().switch() === xdr.InvokeHostFunctionResultCode.invokeHostFunctionResourceLimitExceeded()
    );
  });
}

export function sendError(method: string, status: string, result: xdr.TransactionResult | undefined): CmiError {
  if (status === "TRY_AGAIN_LATER" || isContention(result)) return contention(method, `send ${status}`);
  return new CmiError("TxFailed", `${method}: send ${status}`);
}

export function onChainError(
  method: string,
  hash: string,
  result: xdr.TransactionResult,
  diagnostics: readonly xdr.DiagnosticEvent[],
  domain: ContractErrorDomain | undefined,
): CmiError {
  if (isContention(result)) return contention(method, `resource limit exceeded (tx ${hash})`);
  const code = codeFromDiagnostics(diagnostics);
  if (code !== null) return fromCode(method, code, domain);
  return new CmiError("TxFailed", `${method}: failed on-chain (tx ${hash})`);
}
