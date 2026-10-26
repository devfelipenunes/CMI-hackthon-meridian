import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  FINALIZATION_GRACE_LEDGERS,
  GRUMPKIN_G,
  Secret,
  TOKEN_H,
  addressToField,
  bidCommitment,
  bidNullifier,
  buildSetSpenderWitness,
  deriveTokenKeys,
  encryptEnvelope,
  generateTokenKeys,
  keypairSigner,
  newBidSecrets,
  scalarMul,
  type AuctionPort,
  type BidSecrets,
  type TokenKeys,
  type OnChainDelegation,
  type Prover,
  type Rng,
} from "@zolvency-cmi/core";
import {
  AURORA,
  CallLog,
  FAKE_PLATFORM,
  FakeAuction,
  FakeClock,
  FakeFactory,
  FakeProver,
  FakeToken,
  MemoryLogger,
  SeededRng,
  fakeBidRecord,
} from "@zolvency-cmi/testing";

import { CmiOperator, InMemoryOperatorKeyStore } from "../../src/index.js";

export const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
export const SK_OP = 0x0a0c_7105_0002_1234_5678n;

export const SK_ENV = 987_654_321_098n;
export const MARKET_ID = 42n;
export const CLOSE = 1_000;
export const SELLER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6)).secret());
export const SUBMITTER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5)).secret());
const PK_ENV = scalarMul(SK_ENV, GRUMPKIN_G);
const Y_OP = deriveTokenKeys(SK_OP, addressToField(TOKEN)).Y;

export interface BidSpec {
  price: bigint;
  quantity: number;

  vA?: bigint;

  tamper?: boolean;

  revoked?: boolean;
}

export const AURORA_BIDS: BidSpec[] = AURORA.bids.map((b) => ({ price: b.price, quantity: b.quantity }));

function delegation(owner: TokenKeys, vA: bigint, spender: string, rng: Rng): OnChainDelegation {
  const w = buildSetSpenderWitness(
    { keys: owner, spend: new Secret({ v: vA + 1_000n, r: 7n }), vA, yOp: Y_OP, opI: addressToField(spender), kAudS: TOKEN_H },
    rng,
  );
  const p = w.payload;
  return { allowanceCommitment: p.cA, encryptedAllowance: p.aTilde, escrowedDvk: p.escrowedDvk, allowanceSalt: p.sigmaA, liveUntilLedger: 1_000_000 };
}

export async function closedMarket(
  bids: readonly BidSpec[],
  opts: { commitmentsRoot?: bigint; totalQuotas?: number; prover?: Prover } = {},
) {
  const rng = new SeededRng("operator-market");
  const log = new CallLog();
  const clock = new FakeClock(CLOSE);
  const params = { quotaAsset: TOKEN, totalQuotas: opts.totalQuotas ?? AURORA.totalQuotas, minPricePerQuota: AURORA.minPricePerQuota, closeLedger: CLOSE, eligibilityPolicy: null, feeReserve: 50_000_000n };
  const token = new FakeToken({ log, clock });
  const auction = new FakeAuction({ log, clock, params, seller: SELLER.address, marketId: MARKET_ID, state: "Open", token, ...(opts.commitmentsRoot === undefined ? {} : { commitmentsRoot: opts.commitmentsRoot }) });

  const tokenAddrF = addressToField(TOKEN);
  token.registerAccount(auction.address, Y_OP);
  for (const who of [SELLER.address, FAKE_PLATFORM.feeWallet]) {
    const k = generateTokenKeys(tokenAddrF, rng);
    token.registerAccount(who, k.Y, undefined, k.PVK);
  }
  const secrets: BidSecrets[] = [];
  const bidders: string[] = [];
  for (const [i, b] of bids.entries()) {
    const bidder = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 20 + i)).publicKey();
    const owner = generateTokenKeys(tokenAddrF, rng);
    token.registerAccount(bidder, owner.Y, undefined, owner.PVK);
    const s = newBidSecrets(b.price, rng).expose();
    const { envelope } = encryptEnvelope(s, PK_ENV, rng);
    auction.seedBid(
      fakeBidRecord({
        bidder,
        commitment: bidCommitment({ ...s, marketId: MARKET_ID, participantId: i }),
        nullifier: bidNullifier(s.nullifierSeed, MARKET_ID, i),
        requestedQuantity: b.quantity,
        envelope: b.tamper ? { ...envelope, ctPrice: envelope.ctPrice + 1n } : envelope,
      }),
    );
    if (!b.revoked) token.delegations.set(`${bidder}|${auction.address}`, delegation(owner, b.vA ?? b.price * BigInt(b.quantity), auction.address, rng));
    secrets.push(s);
    bidders.push(bidder);
  }
  await auction.closeMarket(SELLER);

  const logger = new MemoryLogger();
  const prover = opts.prover ?? new FakeProver(log);
  const operator = makeOperator({ auction, token, prover, logger, log, clock });
  return { auction, token, operator, prover, logger, secrets, bidders, log, clock };
}

export function makeOperator(p: { auction: AuctionPort; token: FakeToken; prover: Prover; logger: MemoryLogger; log: CallLog; clock: FakeClock }): CmiOperator {
  return new CmiOperator({
    keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(SK_OP), envelopeKey: new Secret(SK_ENV), submitter: SUBMITTER }),
    factory: new FakeFactory({ log: p.log, clock: p.clock }),
    tokenAddress: TOKEN,
    prover: p.prover,
    logger: p.logger,
    auction: () => p.auction,
    token: p.token,
  });
}

export async function finalizedMarket(bids: readonly BidSpec[], opts: { totalQuotas?: number; prover?: Prover } = {}) {
  const m = await closedMarket(bids, opts);
  const plan = await m.operator.planAllocation(m.auction.address);
  await m.auction.finalize(SUBMITTER, plan.filled, new Uint8Array());
  return { ...m, filled: plan.filled };
}

export async function cancelledMarket(bids: readonly BidSpec[], opts: { prover?: Prover } = {}) {
  const m = await closedMarket(bids, opts);
  m.clock.advanceTo(CLOSE + FINALIZATION_GRACE_LEDGERS + 1);
  await m.auction.cancelExpired(SUBMITTER);
  return m;
}
