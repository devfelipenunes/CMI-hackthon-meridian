

export interface ScenarioBid {
  readonly name: string;
  readonly price: bigint;
  readonly quantity: number;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const AURORA = deepFreeze({
  totalQuotas: 1000,
  minPricePerQuota: 500n,
  bids: [
    { name: "Ana", price: 650n, quantity: 200 },
    { name: "Bruno", price: 600n, quantity: 500 },
    { name: "Carla", price: 580n, quantity: 400 },
    { name: "Diego", price: 520n, quantity: 300 },
  ] as readonly ScenarioBid[],
  expected: {
    filled: [200, 500, 300, 0],
    ana: { gross: 130_000n, seller: 117_000n, fee: 13_000n },
  },
});
