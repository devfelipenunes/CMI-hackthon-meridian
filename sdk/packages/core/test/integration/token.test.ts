import type { Keypair } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Secret,
  addressToField,
  buildRegisterWitness,
  buildRevokeSpenderWitness,
  buildSetSpenderWitness,
  buildSpenderTransferWitness,
  chainTokenPort,
  createProver,
  encodeRegisterData,
  encodeRevokeSpenderData,
  encodeSetSpenderData,
  encodeSpenderTransferData,
  generateTokenKeys,
  keypairSigner,
  pedersenCommit,
  recoverDelegation,
  type Opening,
  type Point,
  type SetSpenderWitness,
  type Signer,
  type SpenderTransferWitness,
  type TokenKeys,
  type TokenPort,
} from "../../src/index.js";
import { fundedKeypair, local } from "../helpers/localnet.js";

const AUDITOR_ID = 0;
const DEPOSIT = 200_000n;
const COLLATERAL = 130_000n;
const PAYMENT = 78_000n;

const RELOCK = 10_000n;

interface Party {
  kp: Keypair;
  signer: Signer;
  keys: TokenKeys;
}

const isPoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

describe("TokenPort real contra o Confidential Token da rede local", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  let token: TokenPort;
  let tokenAddrF: bigint;
  let kAud: Point;
  let chainLedger: () => Promise<number>;
  let bidder: Party;
  let spender: Party;
  let seller: Party;

  let spend: Secret<Opening>;
  let lock: SetSpenderWitness;
  let leg: SpenderTransferWitness;

  async function newParty(): Promise<Party> {
    const kp = await fundedKeypair();
    return { kp, signer: keypairSigner(kp.secret()), keys: generateTokenKeys(tokenAddrF) };
  }

  async function register(p: Party): Promise<void> {
    const w = buildRegisterWitness(p.keys);
    const { proof } = await prover.prove("register", w.inputs);
    await token.register(p.signer, AUDITOR_ID, encodeRegisterData(w, proof));
  }

  async function lockFor(p: Party, s: Party, liveUntil: number, from: Secret<Opening>, vA = COLLATERAL): Promise<SetSpenderWitness> {
    const w = buildSetSpenderWitness({ keys: p.keys, spend: from, vA, yOp: s.keys.Y, opI: addressToField(s.kp.publicKey()), kAudS: kAud });
    const { proof } = await prover.prove("set_spender", w.inputs);
    await token.setSpender(p.signer, s.kp.publicKey(), liveUntil, encodeSetSpenderData(w, proof));
    return w;
  }

  beforeAll(async () => {
    const l = local();
    token = chainTokenPort({ chain: l.chain, token: l.token, auditor: l.auditor });
    tokenAddrF = addressToField(l.token);
    kAud = await token.auditorKey(AUDITOR_ID);
    chainLedger = () => l.chain.latestLedger();
    [bidder, spender, seller] = await Promise.all([newParty(), newParty(), newParty()]);
    for (const p of [bidder, spender, seller]) await register(p);
  });

  afterAll(async () => {
    await prover.destroy();
  });

  it("register + deposit + merge moves balance to spendable", async () => {
    await token.deposit(bidder.signer, DEPOSIT);
    await token.merge(bidder.signer);
    spend = new Secret({ v: DEPOSIT, r: 0n });

    const acc = (await token.account(bidder.kp.publicKey()))!;
    expect(isPoint(acc.spendingKey, bidder.keys.Y)).toBe(true);
    expect(isPoint(acc.spendableBalance, pedersenCommit(DEPOSIT, 0n))).toBe(true);
    expect(isPoint(acc.receivingBalance, pedersenCommit(0n, 0n))).toBe(true);
  });

  it("set_spender locks vA and on-chain C_a equals predicted C_a", async () => {
    lock = await lockFor(bidder, spender, (await chainLedger()) + 20_000, spend);
    spend = lock.next;

    const d = (await token.delegation(bidder.kp.publicKey(), spender.kp.publicKey()))!;
    expect(isPoint(d.allowanceCommitment, pedersenCommit(COLLATERAL, lock.delegation.expose().rA))).toBe(true);
    expect(isPoint(d.allowanceCommitment, lock.payload.cA)).toBe(true);
    expect(await token.isSpender(bidder.kp.publicKey(), spender.kp.publicKey())).toBe(true);
    const acc = (await token.account(bidder.kp.publicKey()))!;
    const o = spend.expose();
    expect(o.v).toBe(DEPOSIT - COLLATERAL);
    expect(isPoint(acc.spendableBalance, pedersenCommit(o.v, o.r))).toBe(true);
  });

  it("second set_spender fails with Token.DelegationAlreadyExists", async () => {
    await expect(lockFor(bidder, spender, (await chainLedger()) + 20_000, spend, RELOCK)).rejects.toMatchObject({
      code: "Token.DelegationAlreadyExists",
    });
  });

  it("spender_transfer by a registered account spender", async () => {
    const onChain = (await token.delegation(bidder.kp.publicKey(), spender.kp.publicKey()))!;
    const allowance = recoverDelegation(onChain, spender.keys.sk, addressToField(spender.kp.publicKey()));
    expect(allowance.expose().vA).toBe(COLLATERAL);

    leg = buildSpenderTransferWitness({
      skOp: spender.keys.sk, yOp: spender.keys.Y, allowance, vTx: PAYMENT, pvkRecipient: seller.keys.PVK, kAudR: kAud, kAudS: kAud,
    });
    const { proof } = await prover.prove("spender_transfer", leg.inputs);
    await token.spenderTransfer(spender.signer, bidder.kp.publicKey(), seller.kp.publicKey(), encodeSpenderTransferData(leg, proof));

    const d = (await token.delegation(bidder.kp.publicKey(), spender.kp.publicKey()))!;
    expect(isPoint(d.allowanceCommitment, leg.payload.cANew)).toBe(true);
    const sellerAcc = (await token.account(seller.kp.publicKey()))!;
    expect(isPoint(sellerAcc.receivingBalance, pedersenCommit(0n, 0n))).toBe(false);
  });

  it("revoke_spender returns funds and isSpender becomes false", async () => {
    const left = leg.next.expose();
    expect(left.vA).toBe(COLLATERAL - PAYMENT);
    const w = buildRevokeSpenderWitness({
      keys: bidder.keys, spend, opI: addressToField(spender.kp.publicKey()),
      allowance: new Secret({ vA: left.vA, sigmaA: left.sigmaA }), kAudS: kAud,
    });
    const { proof } = await prover.prove("revoke_spender", w.inputs);
    await token.revokeSpender(bidder.signer, spender.kp.publicKey(), encodeRevokeSpenderData(w, proof));
    spend = w.next;

    expect(await token.isSpender(bidder.kp.publicKey(), spender.kp.publicKey())).toBe(false);
    expect(await token.delegation(bidder.kp.publicKey(), spender.kp.publicKey())).toBeNull();
    const o = spend.expose();
    expect(o.v).toBe(DEPOSIT - PAYMENT);
    expect(isPoint((await token.account(bidder.kp.publicKey()))!.spendableBalance, pedersenCommit(o.v, o.r))).toBe(true);
  });

  it("set_spender with past live_until is accepted by token", async () => {

    const past = (await chainLedger()) - 1;
    const w = await lockFor(bidder, spender, past, spend, RELOCK);
    spend = w.next;

    const d = (await token.delegation(bidder.kp.publicKey(), spender.kp.publicKey()))!;
    expect(d.liveUntilLedger).toBe(past);
    expect(await token.isSpender(bidder.kp.publicKey(), spender.kp.publicKey())).toBe(false);
  });
});
