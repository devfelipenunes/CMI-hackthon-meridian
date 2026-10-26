import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Secret, addressToField, deriveTokenKeys, keypairSigner } from "@zolvency-cmi/core";
import { CallLog, FakeClock, FakeFactory, FakeProver, MemoryLogger, assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { CmiOperator, InMemoryOperatorKeyStore } from "../../src/index.js";

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 4));
const SK_OP = 0x0a0c_7105_0002_1234_5678n;
const SK_ENV = 987_654_321_098n;
const SUBMITTER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
const SELLER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6)).secret());
const params = { quotaAsset: TOKEN, totalQuotas: 10, minPricePerQuota: 500n, closeLedger: 1_000, eligibilityPolicy: null, feeReserve: 50_000_000n };

function setup() {
  const log = new CallLog();
  const factory = new FakeFactory({ log, clock: new FakeClock(10) });
  const prover = new FakeProver(log);
  const logger = new MemoryLogger();
  const keys = new InMemoryOperatorKeyStore({ spenderKey: new Secret(SK_OP), envelopeKey: new Secret(SK_ENV), submitter: keypairSigner(SUBMITTER.secret()) });
  const operator = new CmiOperator({ keys, factory, tokenAddress: TOKEN, prover, logger });
  return { log, factory, prover, logger, operator };
}

describe("CmiOperator.registerDataForNextMarket (RF-01, D-02)", () => {
  it("registerDataForNextMarket targets predictMarketAddress(next_market_id)", async () => {
    const { operator, factory } = setup();
    const r = await operator.registerDataForNextMarket();
    expect(r.marketId).toBe(await factory.nextMarketId());
    expect(r.address).toBe(await factory.predictMarketAddress(r.marketId));
    expect(r.registerData.length).toBeGreaterThan(14_592);
  });

  it("register witness binds the token address (D-02), not the market address", async () => {
    const { operator, prover, factory } = setup();
    const first = await operator.registerDataForNextMarket();
    await factory.createMarket(SELLER, params, first.registerData);
    const second = await operator.registerDataForNextMarket();

    const opKeys = deriveTokenKeys(SK_OP, addressToField(TOKEN));
    const inputs = prover.proved[0]!.inputs;
    expect(BigInt(inputs.addr_f as string)).toBe(addressToField(TOKEN));
    expect(BigInt(inputs.y_x as string)).toBe(opKeys.Y.x);

    expect(second.address).not.toBe(first.address);
    expect(Buffer.from(second.registerData)).toEqual(Buffer.from(first.registerData));
    expect(prover.proved).toHaveLength(1);
  });

  it("keystore keys are never logged", async () => {
    const { operator, logger } = setup();
    const r = await operator.registerDataForNextMarket();
    const keys = deriveTokenKeys(SK_OP, addressToField(TOKEN));
    expect(logger.entries.length).toBeGreaterThan(0);
    const json = JSON.stringify({ ...r, registerData: [] }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    assertNoSecretLeak([SK_OP, SK_ENV, keys.vk.expose()], [logger, json, operator]);
  });

  it("the in-memory keystore returns its keys as Secret", async () => {
    const { operator } = setup();
    expect(JSON.stringify(operator)).not.toContain(SK_OP.toString());
    const ks = new InMemoryOperatorKeyStore({ spenderKey: new Secret(SK_OP), envelopeKey: new Secret(SK_ENV), submitter: keypairSigner(SUBMITTER.secret()) });
    expect(await ks.spenderKey()).toBeInstanceOf(Secret);
    expect(String(await ks.envelopeKey())).toBe("[redacted]");
    expect((await ks.submitter()).address).toBe(SUBMITTER.publicKey());
  });
});
