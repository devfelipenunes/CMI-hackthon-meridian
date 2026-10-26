

export type ServiceErrorCode =
  | "ConfigInvalid"
  | "MasterKeyInvalid"
  | "KeyNotFound"
  | "KeyAlreadyExists"
  | "EnvelopeKeyMismatch"
  | "LeaseHeld"
  | "MarketNotFound"
  | "BootCheckFailed";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

export function errorCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
  return "UnexpectedError";
}
