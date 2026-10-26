import { describe, expect, it } from "vitest";

import { sponge } from "@ctd/sdk";

const VECTORS: Array<[bigint[], bigint]> = [
  [[1001n, 650n, 42n, 7n, 111222333444n, 999888777n], 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281n],
  [[1002n, 5n, 6n, 0n], 0x21e3ac7533988800a82ff5c91e9ee5d7dd406c910488a117ca83e196f120ea52n],
  [[1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], 0x01dec21c6e1b30609eda618d7e35e5d9d6152f8fa67320d939c1a89603647142n],
  [[1n, 2n, 3n], 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8n],
];

describe("ctd-sdk poseidon2 sponge", () => {
  it.each(VECTORS)("matches CMI vector %#", (inputs, expected) => {
    expect(sponge(inputs)).toBe(expected);
  });
});
