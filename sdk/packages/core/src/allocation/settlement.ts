import { assertPriceRange } from "../bid/bid.js";
import { Secret } from "../secret.js";

export const FEE_BPS = 1_000n;

export interface SettlementAmounts {
  gross: bigint;
  fee: bigint;
  feeRem: bigint;
  seller: bigint;
  refund: bigint;
}

function assertU32(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new RangeError(`${name} must be a u32`);
}

export function settlementAmounts(
  price: bigint,
  requested: number,
  filled: number,
  feeBps: bigint = FEE_BPS,
): Secret<SettlementAmounts> {
  assertPriceRange(price);
  assertU32(requested, "requested");
  assertU32(filled, "filled");
  if (filled > requested) throw new RangeError("filled must not exceed requested");
  if (feeBps < 0n || feeBps > 10_000n) throw new RangeError("feeBps must be in [0, 10000]");

  const gross = price * BigInt(filled);
  const fee = (gross * feeBps) / 10_000n;
  const feeRem = (gross * feeBps) % 10_000n;
  return new Secret({ gross, fee, feeRem, seller: gross - fee, refund: price * BigInt(requested - filled) });
}
