import { CmiError, type CmiErrorCode } from "@zolvency-cmi/core";

export interface CallEntry {
  name: string;
  write: boolean;
  args: readonly unknown[];
}

export class CallLog {
  readonly entries: CallEntry[] = [];

  record(name: string, write: boolean, args: readonly unknown[] = []): void {
    this.entries.push({ name, write, args });
  }

  all(): string[] {
    return this.entries.map((e) => e.name);
  }

  names(): string[] {
    return this.all();
  }

  writes(): string[] {
    return this.entries.filter((e) => e.write).map((e) => e.name);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export function contractError(code: CmiErrorCode, why: string): CmiError {
  return new CmiError(code, why, code === "ResourceContention" ? { recovery: "retry_next_ledger" } : {});
}
