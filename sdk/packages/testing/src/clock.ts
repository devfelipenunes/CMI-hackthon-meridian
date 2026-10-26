import type { Clock } from "@zolvency-cmi/core";

export class FakeClock implements Clock {
  #ledger: number;

  constructor(start = 1) {
    this.#ledger = start;
  }

  async ledger(): Promise<number> {
    return this.#ledger;
  }

  advanceTo(ledger: number): void {
    if (ledger < this.#ledger) throw new Error(`FakeClock: ${ledger} < ${this.#ledger}`);
    this.#ledger = ledger;
  }

  advanceBy(ledgers: number): void {
    this.advanceTo(this.#ledger + ledgers);
  }
}
