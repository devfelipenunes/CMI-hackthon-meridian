import { createHash, timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Logger } from "pino";

import type { ServiceConfig } from "../config/load.js";
import type { MarketRow, Repos } from "../db/repos.js";
import { errorCode } from "../errors.js";
import type { RegisterDataView } from "../markets/register-data.js";
import type { OperatorLoop } from "../runner/loop.js";
import { VERSION } from "../version.js";
import {
  ActionViewT,
  AlertIdParamsT,
  AlertViewT,
  AlertsQueryT,
  ErrorT,
  MarketDetailT,
  MarketIdParamsT,
  MarketSummaryT,
  MarketsQueryT,
  OperatorStatusT,
  PageQueryT,
  RegisterDataT,
  page,
  type AlertsQuery,
  type MarketDetailBody,
  type MarketSummaryBody,
  type MarketsQuery,
  type OperatorStatusBody,
  type PageQuery,
} from "./schemas.js";

export type OperatorStatus = OperatorStatusBody;

export interface ApiDeps {
  config: ServiceConfig;
  repos: Repos;
  loop: Pick<OperatorLoop, "pause" | "resume" | "requestDiscovery" | "resync">;
  status(): Promise<OperatorStatus>;
  ready(): Promise<{ ok: boolean; failing: string[] }>;
  registerData(): Promise<RegisterDataView>;
  latestLedger(): Promise<number>;
  logger: Logger;
}

type Access = "public" | "read" | "admin";

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
  }
}

const MARKET_STATUSES = new Set(["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"]);

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function keyMatches(key: string, expectedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const got = sha256(key);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const security = [{ apiKey: [] }];
const errors = { 400: ErrorT, 401: ErrorT, 403: ErrorT, 404: ErrorT };

export async function buildApi(d: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: d.logger.child({ component: "api" }, { level: "warn" }) as FastifyBaseLogger, ajv: { customOptions: { coerceTypes: true, removeAdditional: false } } });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "CMI Auctions — Operator API",
        version: VERSION,
        description:
          "Back-end do operador do CMI Auctions. Observação e operação do serviço; nenhuma rota devolve preço, preço de corte ou valor (OP-16). Autenticação: header `x-api-key` (chaves `read` e `admin`).",
      },
      components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const origins = d.config.api.corsOrigins;
  await app.register(cors, {
    delegator: (req, cb) => cb(null, { origin: req.url?.startsWith("/v1/register-data") === true && origins.length > 0 ? origins : false, methods: ["GET"] }),
  });

  app.addSchema(ErrorT);

  app.addHook("onRequest", async (req: FastifyRequest) => {
    const access: Access = req.routeOptions.config.access ?? (req.url.startsWith("/docs") ? "public" : "read");
    if (access === "public") return;
    const key = req.headers["x-api-key"];
    if (typeof key !== "string" || key === "") throw new HttpError(401, "Unauthorized", "missing x-api-key");
    const isAdmin = keyMatches(key, d.config.api.adminKeySha256);
    const isRead = isAdmin || keyMatches(key, d.config.api.readKeySha256);
    if (!isRead) throw new HttpError(401, "Unauthorized", "invalid x-api-key");
    if (access === "admin" && !isAdmin) throw new HttpError(403, "Forbidden", "this route needs the admin key");
  });

  app.setErrorHandler((err: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation !== undefined) return reply.status(400).send({ error: { code: "ValidationError", message: e.message ?? "invalid request" } });
    if (typeof e.statusCode === "number" && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: "BadRequest", message: e.message ?? "bad request" } });
    d.logger.error({ err, code: errorCode(err) }, "api error");

    return reply.status(500).send({ error: { code: errorCode(err) === "UnexpectedError" ? "InternalError" : errorCode(err), message: "internal error" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NotFound", message: "route not found" } }));

  app.get("/openapi.json", { config: { access: "public" }, schema: { hide: true } }, async () => app.swagger());

  app.get("/health", { config: { access: "public" }, schema: { tags: ["health"], response: { 200: Type.Object({ ok: Type.Boolean() }) } } }, async () => ({ ok: true }));

  app.get(
    "/ready",
    { schema: { tags: ["health"], security, response: { 200: Type.Object({ ok: Type.Boolean(), failing: Type.Array(Type.String()) }), 503: Type.Object({ ok: Type.Boolean(), failing: Type.Array(Type.String()) }), ...errors } } },
    async (_req, reply) => {
      const r = await d.ready();
      return reply.status(r.ok ? 200 : 503).send(r);
    },
  );

  app.get("/v1/status", { schema: { tags: ["status"], security, response: { 200: OperatorStatusT, ...errors } } }, () => d.status());

  app.get<{ Querystring: MarketsQuery }>(
    "/v1/markets",
    { schema: { tags: ["markets"], security, querystring: MarketsQueryT, response: { 200: page(MarketSummaryT), ...errors } } },
    async (req) => {
      const status = req.query.status?.split(",").filter((s) => s !== "");
      if (status?.some((s) => !MARKET_STATUSES.has(s))) throw new HttpError(400, "ValidationError", "unknown market status");
      const limit = req.query.limit ?? 50;
      const rows = d.repos.markets.list({
        ...(status === undefined ? {} : { status: status as MarketRow["status"][] }),
        ...(req.query.supported === undefined ? {} : { supported: req.query.supported }),
        ...(req.query.cursor === undefined ? {} : { after: BigInt(req.query.cursor) }),
        limit,
      });
      const ledger = await d.latestLedger().catch(() => null);
      return { items: rows.map((m) => summary(m, d, ledger)), next: rows.length === limit ? rows.at(-1)!.marketId.toString() : null };
    },
  );

  app.get<{ Params: { marketId: string } }>(
    "/v1/markets/:marketId",
    { schema: { tags: ["markets"], security, params: MarketIdParamsT, response: { 200: MarketDetailT, ...errors } } },
    async (req): Promise<MarketDetailBody> => {
      const m = d.repos.markets.get(BigInt(req.params.marketId));
      if (m === null) throw new HttpError(404, "MarketNotFound", "unknown market");
      const bids = d.repos.bids.forMarket(m.marketId);
      const ledger = await d.latestLedger().catch(() => null);
      const allocated = m.status === "Finalized" || m.status === "Settled";
      return {
        ...summary(m, d, ledger),
        quotaAsset: m.quotaAsset,
        finalizationGraceLedgers: m.graceLedgers,
        contractsVersion: m.contractsVersion,
        allocation: allocated ? bids.map((b) => b.filledQuantity) : null,
        unsold: m.unsold,
        bids: bids.map((b) => ({
          bidIndex: b.bidIndex,
          bidder: b.bidder,
          participantId: b.participantId,
          requestedQuantity: b.requestedQuantity,
          filledQuantity: b.filledQuantity,
          status: b.status,
          delegationLive: b.delegationLive,
          quarantined: b.quarantined,
        })),
      };
    },
  );

  app.get<{ Params: { marketId: string }; Querystring: PageQuery }>(
    "/v1/markets/:marketId/actions",
    { schema: { tags: ["markets"], security, params: MarketIdParamsT, querystring: PageQueryT, response: { 200: page(ActionViewT), ...errors } } },
    async (req) => {
      const id = BigInt(req.params.marketId);
      if (d.repos.markets.get(id) === null) throw new HttpError(404, "MarketNotFound", "unknown market");
      const limit = req.query.limit ?? 50;
      const rows = d.repos.actions.forMarket(id, { limit, ...(req.query.cursor === undefined ? {} : { before: Number(req.query.cursor) }) });
      return {
        items: rows.map((a) => ({ ...a, marketId: undefined, feeCharged: a.feeCharged?.toString() ?? null })),
        next: rows.length === limit ? String(rows.at(-1)!.id) : null,
      };
    },
  );

  app.get<{ Querystring: AlertsQuery }>(
    "/v1/alerts",
    { schema: { tags: ["alerts"], security, querystring: AlertsQueryT, response: { 200: page(AlertViewT), ...errors } } },
    async (req) => {
      const limit = req.query.limit ?? 50;
      const rows = d.repos.alerts.list({
        limit,
        ...(req.query.open === undefined ? {} : { open: req.query.open }),
        ...(req.query.severity === undefined ? {} : { severity: req.query.severity }),
        ...(req.query.cursor === undefined ? {} : { before: Number(req.query.cursor) }),
      });
      return {
        items: rows.map((a) => ({ id: a.id, severity: a.severity, kind: a.kind, marketId: a.marketId?.toString() ?? null, bidIndex: a.bidIndex, message: a.message, at: a.at, ackedAt: a.ackedAt })),
        next: rows.length === limit ? String(rows.at(-1)!.id) : null,
      };
    },
  );

  app.post<{ Params: { id: number } }>(
    "/v1/alerts/:id/ack",
    { config: { access: "admin" }, schema: { tags: ["alerts"], security, params: AlertIdParamsT, response: { 204: Type.Null(), ...errors } } },
    async (req, reply) => {
      if (!d.repos.alerts.ack(req.params.id)) throw new HttpError(404, "AlertNotFound", "unknown or already acknowledged alert");
      return reply.status(204).send();
    },
  );

  const adminAction = (path: string, summaryText: string, fn: () => void): void => {
    app.post(path, { config: { access: "admin" }, schema: { tags: ["operation"], summary: summaryText, security, response: { 204: Type.Null(), ...errors } } }, async (_req, reply) => {
      fn();
      return reply.status(204).send();
    });
  };
  adminAction("/v1/keeper/pause", "Para de enviar transações (continua lendo e sincronizando)", () => d.loop.pause());
  adminAction("/v1/keeper/resume", "Volta a enviar transações; todo mercado é visto de novo", () => d.loop.resume());
  adminAction("/v1/discovery/rescan", "Varre a Factory na próxima volta", () => d.loop.requestDiscovery());

  app.post<{ Params: { marketId: string } }>(
    "/v1/markets/:marketId/resync",
    { config: { access: "admin" }, schema: { tags: ["operation"], summary: "O mercado é visto na próxima volta", security, params: MarketIdParamsT, response: { 204: Type.Null(), ...errors } } },
    async (req, reply) => {
      if (!d.loop.resync(BigInt(req.params.marketId))) throw new HttpError(404, "MarketNotFound", "unknown market");
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/register-data",
    {
      config: { access: "public" },
      schema: {
        tags: ["seller"],
        summary: "O register_data que o front do seller passa ao create_market (RF-01, D-02). Público: o valor vai on-chain em todo create_market.",
        response: { 200: RegisterDataT, ...errors },
      },
    },
    async () => {
      const r = await d.registerData();
      return { marketId: r.marketId.toString(), address: r.address, registerData: Buffer.from(r.registerData).toString("base64") };
    },
  );

  await app.ready();
  return app;
}

function summary(m: MarketRow, d: ApiDeps, ledger: number | null): MarketSummaryBody {
  const bids = d.repos.bids.forMarket(m.marketId);
  const estimated =
    ledger === null || m.status !== "Open" && m.status !== "Created" ? null : new Date(Date.now() + Math.max(0, m.closeLedger - ledger) * d.config.tuning.secondsPerLedger * 1000).toISOString();
  return {
    marketId: m.marketId.toString(),
    address: m.address,
    seller: m.seller,
    status: m.status,
    supported: m.supported,
    totalQuotas: m.totalQuotas,
    minPricePerQuota: m.minPricePerQuota.toString(),
    bidCount: m.bidCount,
    demand: bids.reduce((s, b) => s + b.requestedQuantity, 0),
    closeLedger: m.closeLedger,
    finalizeByLedger: m.finalizeByLedger,
    estimatedCloseAt: estimated,
    nextCheckLedger: m.nextCheckLedger,
    lastSyncedLedger: m.lastSyncedLedger,
  };
}
