
export interface Clock {
  ledger(): Promise<number>;
}
