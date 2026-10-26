import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { secretsOf, type BidSpec } from "../helpers/world.js";
import { ADMIN_KEY, runUntil, testService } from "../helpers/service.js";

describe("auditoria de privacidade", () => {
  it("no price or secret in logs, database, API responses, OpenAPI, alerts or webhook", async () => {
    const posted: unknown[] = [];
    const s = await testService({
      config: { alertWebhookUrl: "http://hooks.example/x" },
      webhook: async (_url, body) => void posted.push(body),
      retry: { maxAttempts: 1 },
    });

    const DISTINCT: BidSpec[] = [
      { price: 650_137_911n, quantity: 200 },
      { price: 600_248_813n, quantity: 500 },
      { price: 580_391_027n, quantity: 400 },
      { price: 520_473_339n, quantity: 300 },
    ];
    const bids = DISTINCT.map((b, i) => (i === 3 ? { ...b, revoked: true } : b));
    const a = await s.world.market(bids, { closeIn: 5 });
    await s.world.market(DISTINCT.map((b, i) => (i === 0 ? { ...b, tamper: true } : b)), { closeIn: 5 });
    await runUntil(s, async () => (await a.auction.getState()) === "Finalized");
    a.auction.failNext("settle", "Auction.InvalidSettlementProof");
    await runUntil(s, async () => (await a.auction.getSettlementStatus(3)) !== "Pending");
    await s.step(40);

    const secrets = secretsOf(s.world);
    expect(secrets.length).toBeGreaterThan(10);

    expect(() => assertNoSecretLeak(secrets, [`{"x":${DISTINCT[1]!.price}}`])).toThrow();

    assertNoSecretLeak(secrets, s.lines);

    const tables = ["meta", "markets", "bids", "actions", "alerts"].map((t) => JSON.stringify(s.db.prepare(`SELECT * FROM ${t}`).all()));
    const keys = JSON.stringify(s.db.prepare("SELECT name, public, created_at FROM keys").all());
    assertNoSecretLeak(secrets, [...tables, keys]);

    const headers = { "x-api-key": ADMIN_KEY };
    const urls = ["/health", "/ready", "/v1/status", "/v1/markets", "/v1/markets/1", "/v1/markets/2", "/v1/markets/1/actions", "/v1/markets/2/actions", "/v1/alerts", "/v1/register-data", "/docs/json"];
    const bodies: string[] = [];
    for (const url of urls) bodies.push((await s.api.inject({ url, headers })).body);
    assertNoSecretLeak(secrets, bodies);

    expect(posted.length).toBeGreaterThan(0);
    assertNoSecretLeak(secrets, [JSON.stringify(posted)]);
    expect(s.repos.alerts.list({ limit: 50 }).map((x) => x.kind)).toEqual(expect.arrayContaining(["BidQuarantined", "IntegrityMismatch"]));
    await s.close();
  });
});
