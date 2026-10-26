import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  GRUMPKIN_G,
  MIN_FEE_RESERVE,
  Secret,
  TOKEN_H,
  addressToField,
  bidCommitment,
  bidNullifier,
  buildSetSpenderWitness,
  encryptEnvelope,
  generateTokenKeys,
  keypairSigner,
  newBidSecrets,
  scalarMul,
  deriveTokenKeys,
  type BidSecrets,
  type OnChainDelegation,
  type Rng,
  type Signer,
  type TokenKeys,
} from "@zolvency-cmi/core";
import { AURORA, CallLog, FAKE_PLATFORM, FakeClock, FakeFactory, FakeProver, FakeToken, SeededRng, fakeBidRecord, type FakeAuction } from "@zolvency-cmi/testing";

import { TxSink, type ChainPorts } from "../../src/chain/ports.js";
import { POC_ENVELOPE_SCALAR } from "../../src/keys/store.js";

export const SK_OP = 0x0a0c_7105_0002_1234_5678n;
export const SK_ENV = POC_ENVELOPE_SCALAR;
export const SUBMITTER_SECRET = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5)).secret();
export const SELLER: Signer = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6)).secret());
export const TOKEN = FAKE_PLATFORM.collateralToken;
export const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));

export interface BidSpec {
  price: bigint;
  quantity: number;

  tamper?: boolean;

  revoked?: boolean;
}

export const AURORA_BIDS: BidSpec[] = AURORA.bids.map((b) => ({ price: b.price, quantity: b.quantity }));

export class World {
  readonly log = new CallLog();
  readonly clock = new FakeClock(100);
  readonly token = new FakeToken({ log: this.log, clock: this.clock });
  readonly factory = new FakeFactory({ log: this.log, clock: this.clock, token: this.token });
  readonly prover = new FakeProver(this.log);
  readonly rng: Rng = new SeededRng("operator-backend");
  readonly sink = new TxSink();

  readonly secrets: BidSecrets[] = [];
  readonly prices: bigint[] = [];
  readonly #yOp = deriveTokenKeys(SK_OP, addressToField(TOKEN)).Y;
  #rpcDown = false;
  #balances = new Map<string, bigint>();

  constructor() {

    for (const who of [SELLER.address, FAKE_PLATFORM.feeWallet]) {
      const k = generateTokenKeys(addressToField(TOKEN), this.rng);
      this.token.registerAccount(who, k.Y, undefined, k.PVK);
    }
  }

  rpcDown(): void {
    this.#rpcDown = true;
  }

  rpcUp(): void {
    this.#rpcDown = false;
  }

  setBalance(account: string, stroops: bigint): void {
    this.#balances.set(account, stroops);
  }

  ports(): ChainPorts {
    return {
      latestLedger: async () => {
        if (this.#rpcDown) throw Object.assign(new Error("rpc down"), { code: "TxFailed" });
        return this.clock.ledger();
      },
      assertNetwork: async () => undefined,
      factory: this.factory,
      auction: (address) => this.factory.auction(address),
      token: this.token,
      versionOf: async () => "fake-auction-wasm",
      xlmBalance: async (a) => this.#balances.get(a) ?? 1_000n * 10_000_000n,
      txSink: this.sink,
    };
  }

  async market(bids: readonly BidSpec[] = AURORA_BIDS, opts: { closeIn?: number; totalQuotas?: number; open?: boolean } = {}): Promise<{ id: bigint; address: string; auction: FakeAuction }> {
    const now = await this.clock.ledger();
    const params = {
      quotaAsset: QUOTA,
      totalQuotas: opts.totalQuotas ?? AURORA.totalQuotas,
      minPricePerQuota: AURORA.minPricePerQuota,
      closeLedger: now + (opts.closeIn ?? 50),
      eligibilityPolicy: null,
      feeReserve: MIN_FEE_RESERVE,
    };
    const { marketId, address } = await this.factory.createMarket(SELLER, params, new Uint8Array([1]));
    const auction = this.factory.auction(address);
    this.token.registerAccount(address, this.#yOp);
    if (opts.open !== false) await auction.openMarket(SELLER);
    const tokenAddrF = addressToField(TOKEN);
    const pkEnv = scalarMul(SK_ENV, GRUMPKIN_G);
    for (const [i, b] of bids.entries()) {
      const bidder = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 20 + i + Number(marketId) * 10)).publicKey();
      const owner = generateTokenKeys(tokenAddrF, this.rng);
      this.token.registerAccount(bidder, owner.Y, undefined, owner.PVK);
      const s = newBidSecrets(b.price, this.rng).expose();
      const { envelope } = encryptEnvelope(s, pkEnv, this.rng);
      auction.seedBid(
        fakeBidRecord({
          bidder,
          commitment: bidCommitment({ ...s, marketId, participantId: i }),
          nullifier: bidNullifier(s.nullifierSeed, marketId, i),
          requestedQuantity: b.quantity,
          envelope: b.tamper === true ? { ...envelope, ctPrice: envelope.ctPrice + 1n } : envelope,
        }),
      );
      if (b.revoked !== true) this.token.delegations.set(`${bidder}|${address}`, this.#delegation(owner, b.price * BigInt(b.quantity), address));
      this.secrets.push(s);
      this.prices.push(b.price);
    }
    return { id: marketId, address, auction };
  }

  revoke(address: string, bidder: string): void {
    this.token.delegations.delete(`${bidder}|${address}`);
  }

  #delegation(owner: TokenKeys, vA: bigint, spender: string): OnChainDelegation {
    const w = buildSetSpenderWitness(
      { keys: owner, spend: new Secret({ v: vA + 1_000n, r: 7n }), vA, yOp: this.#yOp, opI: addressToField(spender), kAudS: TOKEN_H },
      this.rng,
    );
    const p = w.payload;
    return { allowanceCommitment: p.cA, encryptedAllowance: p.aTilde, escrowedDvk: p.escrowedDvk, allowanceSalt: p.sigmaA, liveUntilLedger: 10_000_000 };
  }
}

export function secretsOf(w: World): bigint[] {
  return [...w.prices, ...w.secrets.flatMap((s) => [s.blinding, s.nullifierSeed]), SK_OP, SK_ENV];
}
