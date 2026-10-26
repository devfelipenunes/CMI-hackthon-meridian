import type { MetaRepo } from "../db/repos.js";

export class InstanceLease {
  readonly #meta: MetaRepo;
  readonly #holder: string;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(o: { meta: MetaRepo; holder: string; ttlMs?: number; now?: () => number }) {
    this.#meta = o.meta;
    this.#holder = o.holder;
    this.#ttlMs = o.ttlMs ?? 5 * 60_000;
    this.#now = o.now ?? Date.now;
  }

  get holder(): string {
    return this.#holder;
  }

  acquire(): boolean {
    return this.#meta.transaction(() => {
      const holder = this.#meta.get("lease_holder");
      const expires = Number(this.#meta.get("lease_expires_ms") ?? "0");
      const now = this.#now();
      if (holder !== null && holder !== this.#holder && expires > now) return false;
      this.#meta.set("lease_holder", this.#holder);
      this.#meta.set("lease_expires_ms", String(now + this.#ttlMs));
      return true;
    });
  }

  release(): void {
    this.#meta.transaction(() => {
      if (this.#meta.get("lease_holder") === this.#holder) {
        this.#meta.delete("lease_holder");
        this.#meta.delete("lease_expires_ms");
      }
    });
  }
}
