

const HALF_XLM = 5_000_000n;
const STEP = 1_000_000n;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function suggestDeposit(needed: bigint, rng: () => number = Math.random): bigint {
  if (needed < 0n) throw new RangeError("the required amount cannot be negative");
  const base = needed === 0n ? HALF_XLM * 2n : needed;
  const percent = 300n + BigInt(Math.floor(rng() * 900));
  let amount = ceilDiv(base * (10_000n + percent), 10_000n);
  amount = ceilDiv(amount, STEP) * STEP;
  if (amount <= needed) amount = needed + STEP;
  return amount;
}
