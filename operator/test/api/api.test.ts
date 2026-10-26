import { describe, expect, it } from "vitest";

import { AURORA_BIDS } from "../helpers/world.js";
import { ADMIN_KEY, READ_KEY, runUntil, testService, type TestService } from "../helpers/service.js";

const read = { "x-api-key": READ_KEY };
const admin = { "x-api-key": ADMIN_KEY };

async function settledService(): Promise<{ s: TestService; id: bigint }> {
  const s = await testService();
  const { id, auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
  await runUntil(s, async () => (await auction.getState()) === "Settled");
  await s.step();
  return { s, id };
}

describe("API: servidor, auth e OpenAPI (passo 4.1, OP-09)", () => {
  it("/health and /v1/register-data are open; everything else needs x-api-key", async () => {
    const s = await testService();
    expect((await s.api.inject({ url: "/health" })).json()).toEqual({ ok: true });
    expect((await s.api.inject({ url: "/v1/register-data" })).statusCode).toBe(200);
    const r = await s.api.inject({ url: "/v1/status" });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: { code: "Unauthorized", message: "missing x-api-key" } });
    expect((await s.api.inject({ url: "/v1/status", headers: { "x-api-key": "wrong" } })).statusCode).toBe(401);
    expect((await s.api.inject({ url: "/v1/status", headers: read })).statusCode).toBe(200);
    await s.close();
  });

  it("admin routes reject the read key (403) and accept the admin key", async () => {
    const s = await testService();
    expect((await s.api.inject({ method: "POST", url: "/v1/keeper/pause", headers: read })).statusCode).toBe(403);
    expect((await s.api.inject({ method: "POST", url: "/v1/keeper/pause", headers: admin })).statusCode).toBe(204);
    expect(s.loop.paused).toBe(true);
    expect((await s.api.inject({ url: "/v1/status", headers: admin })).json().keeper.paused).toBe(true);
    expect((await s.api.inject({ method: "POST", url: "/v1/keeper/resume", headers: admin })).statusCode).toBe(204);
    expect(s.loop.paused).toBe(false);
    await s.close();
  });

  it("CORS allows CMI_CORS_ORIGINS only on /v1/register-data", async () => {
    const s = await testService();
    const origin = { origin: "http://seller.example" };
    expect((await s.api.inject({ url: "/v1/register-data", headers: origin })).headers["access-control-allow-origin"]).toBe("http://seller.example");
    expect((await s.api.inject({ url: "/v1/register-data", headers: { origin: "http://evil.example" } })).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await s.api.inject({ url: "/v1/status", headers: { ...origin, ...read } })).headers["access-control-allow-origin"]).toBeUndefined();
    await s.close();
  });

  it("/openapi.json is OpenAPI 3.1 and lists every route; /docs serves Swagger UI", async () => {
    const s = await testService();
    const doc = (await s.api.inject({ url: "/docs/json" })).json() as { openapi: string; paths: Record<string, unknown>; components: { securitySchemes: unknown } };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        "/health",
        "/ready",
        "/v1/status",
        "/v1/markets",
        "/v1/markets/{marketId}",
        "/v1/markets/{marketId}/actions",
        "/v1/alerts",
        "/v1/alerts/{id}/ack",
        "/v1/keeper/pause",
        "/v1/keeper/resume",
        "/v1/discovery/rescan",
        "/v1/markets/{marketId}/resync",
        "/v1/register-data",
      ].sort(),
    );
    expect(doc.components.securitySchemes).toEqual({ apiKey: { type: "apiKey", in: "header", name: "x-api-key" } });
    expect((await s.api.inject({ url: "/openapi.json" })).json()).toEqual(doc);
    const ui = await s.api.inject({ url: "/docs/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.body).toContain("swagger");
    await s.close();
  });

  it("/ready is 503 listing what failed", async () => {
    const s = await testService();
    s.world.rpcDown();
    const r = await s.api.inject({ url: "/ready", headers: read });
    expect(r.statusCode).toBe(503);
    expect(r.json().failing).toEqual(expect.arrayContaining(["rpc", "loop"]));
    await s.close();
  });

  it("validation errors are 400 ValidationError; unknown routes 404", async () => {
    const s = await testService();
    expect((await s.api.inject({ url: "/v1/markets?limit=0", headers: read })).json().error.code).toBe("ValidationError");
    expect((await s.api.inject({ url: "/v1/markets?status=Nope", headers: read })).json().error.code).toBe("ValidationError");
    expect((await s.api.inject({ url: "/v1/markets/abc", headers: read })).statusCode).toBe(400);
    expect((await s.api.inject({ url: "/nope", headers: read })).statusCode).toBe(404);
    await s.close();
  });
});

describe("API: status, mercados e ações (passo 4.2)", () => {
  it("GET /v1/status", async () => {
    const s = await testService();
    await s.world.market(AURORA_BIDS);
    await s.loop.runOnce();
    const st = (await s.api.inject({ url: "/v1/status", headers: read })).json();
    expect(st).toMatchObject({
      network: "local",
      latestLedger: 100,
      keeper: { paused: false, lastLoopLedger: 100, leader: true },
      discovery: { cursor: "1", nextMarketId: "2", lastScanLedger: 100 },
      envelopeKey: "poc",
      versions: { service: "0.1.0", contracts: "dev" },
      markets: { Open: 1 },
    });
    expect(st.submitter.xlmBalance).toBe("10000000000");
    await s.close();
  });

  it("GET /v1/markets filters by status and paginates", async () => {
    const s = await testService();
    for (let i = 0; i < 3; i++) await s.world.market(AURORA_BIDS, { closeIn: 1_000 });
    await s.world.market([], { closeIn: 2 });
    await runUntil(s, () => s.repos.markets.get(4n)?.status === "Cancelled");
    const p1 = (await s.api.inject({ url: "/v1/markets?status=Open&limit=2", headers: read })).json();
    expect(p1.items.map((m: { marketId: string }) => m.marketId)).toEqual(["1", "2"]);
    expect(p1.next).toBe("2");
    const p2 = (await s.api.inject({ url: `/v1/markets?status=Open&limit=2&cursor=${p1.next}`, headers: read })).json();
    expect(p2).toMatchObject({ items: [{ marketId: "3", demand: 1400, bidCount: 4, status: "Open" }], next: null });
    expect(p2.items[0].estimatedCloseAt).toMatch(/^\d{4}-/);
    const cancelled = (await s.api.inject({ url: "/v1/markets?status=Cancelled", headers: read })).json();
    expect(cancelled.items.map((m: { marketId: string }) => m.marketId)).toEqual(["4"]);
    await s.close();
  });

  it("GET /v1/markets/{id} has the public allocation and bids, and the actions list tx data", async () => {
    const { s, id } = await settledService();
    const m = (await s.api.inject({ url: `/v1/markets/${id}`, headers: read })).json();
    expect(m).toMatchObject({ marketId: "1", status: "Settled", allocation: [200, 500, 300, 0], unsold: 0, minPricePerQuota: "500" });
    expect(m.bids).toHaveLength(4);
    expect(Object.keys(m.bids[0]).sort()).toEqual(["bidIndex", "bidder", "delegationLive", "filledQuantity", "participantId", "quarantined", "requestedQuantity", "status"]);
    const actions = (await s.api.inject({ url: `/v1/markets/${id}/actions`, headers: read })).json();
    expect(actions.items.map((a: { kind: string }) => a.kind)).toEqual(["settle", "settle", "settle", "settle", "finalize", "close"]);
    expect((await s.api.inject({ url: "/v1/markets/99", headers: read })).json().error.code).toBe("MarketNotFound");
    await s.close();
  });
});

describe("API: alertas e operação (passo 4.3)", () => {
  it("alerts filter and ack; resync and rescan", async () => {
    const s = await testService();
    const { id } = await s.world.market(AURORA_BIDS, { closeIn: 500 });
    await s.loop.runOnce();
    const alerts = (await s.api.inject({ url: "/v1/alerts?open=true", headers: read })).json();
    const poc = alerts.items.find((a: { kind: string }) => a.kind === "PocEnvelopeKey");
    expect(poc).toMatchObject({ severity: "info" });
    expect((await s.api.inject({ method: "POST", url: `/v1/alerts/${poc.id}/ack`, headers: admin })).statusCode).toBe(204);
    expect((await s.api.inject({ method: "POST", url: `/v1/alerts/${poc.id}/ack`, headers: admin })).statusCode).toBe(404);

    expect((await s.api.inject({ method: "POST", url: `/v1/markets/${id}/resync`, headers: admin })).statusCode).toBe(204);
    expect(s.repos.markets.get(id)!.nextCheckLedger).toBe(0);
    expect((await s.api.inject({ method: "POST", url: "/v1/markets/77/resync", headers: admin })).statusCode).toBe(404);

    await s.world.market(AURORA_BIDS);
    expect((await s.api.inject({ method: "POST", url: "/v1/discovery/rescan", headers: admin })).statusCode).toBe(204);
    expect((await s.loop.runOnce()).discovered).toEqual([2n]);
    await s.close();
  });

  it("there is no bid retry route (OP-19)", async () => {
    const s = await testService();
    expect((await s.api.inject({ method: "POST", url: "/v1/markets/1/bids/0/retry", headers: admin })).statusCode).toBe(404);
    await s.close();
  });
});

describe("API: register-data (passo 4.4, RF-01)", () => {
  it("returns the predicted marketId, address and base64 register_data, proved once", async () => {
    const s = await testService();
    const a = (await s.api.inject({ url: "/v1/register-data" })).json();
    expect(a.marketId).toBe("1");
    expect(a.address).toMatch(/^C[A-Z2-7]{55}$/);
    expect(Buffer.from(a.registerData, "base64").length).toBeGreaterThan(100);
    await s.world.market(AURORA_BIDS);
    const b = (await s.api.inject({ url: "/v1/register-data" })).json();
    expect(b.marketId).toBe("2");
    expect(b.registerData).toBe(a.registerData);
    expect(s.world.prover.proved.filter((p) => p.circuit === "register")).toHaveLength(1);
    await s.close();
  });
});
