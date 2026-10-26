import { Secret, TOKEN_H, addressToField, deriveTokenKeys, scalarMul } from "../../src/index.js";

const TOKEN = "CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F";
const AUCTION = "CD4E4XLXJVX346V754HW6T77IC5CWG5IZROUMIRGEZYTXWW7O4O765B6";

function seeded(start: bigint) {
  let n = start;
  return { field: () => (n += 7919n), scalar: () => (n += 7919n) };
}

export function fixture(rngStart = 1_000_003n) {
  const bidder = deriveTokenKeys(0x0b1d_de55_0001n, addressToField(TOKEN));
  const auction = deriveTokenKeys(0x0a0c_7105_0002n, addressToField(TOKEN));
  const seller = deriveTokenKeys(0x5e11_e700_0003n, addressToField(TOKEN));
  const feeWallet = deriveTokenKeys(0x0fee_0000_0004n, addressToField(TOKEN));
  return {
    bidder,
    auction,
    seller,
    feeWallet,
    params: {
      keys: bidder,
      spend: new Secret({ v: 300_000n, r: 0x5be0_d000_1234n }),
      vA: 130_000n,
      yOp: auction.Y,
      opI: addressToField(AUCTION),
      kAudS: scalarMul(0x0a0d_17e5n, TOKEN_H),
    },
    rng: seeded(rngStart),
  };
}
