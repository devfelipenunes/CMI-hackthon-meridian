import { Type, type Static } from "@sinclair/typebox";

const U64 = Type.String({ pattern: "^[0-9]{1,20}$", description: "u64 em decimal" });
const Stroops = Type.String({ pattern: "^[0-9]+$", description: "stroops (1 XLM = 10^7)" });
const Nullable = <T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer> | ReturnType<typeof Type.Boolean>>(t: T) => Type.Union([t, Type.Null()]);

export const MarketStatusT = Type.Union(["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"].map((s) => Type.Literal(s)));
export const BidStatusT = Type.Union(["Pending", "Settled", "Failed"].map((s) => Type.Literal(s)));

export const ErrorT = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String() }) }, { $id: "Error" });

export const OperatorStatusT = Type.Object(
  {
    network: Type.Union([Type.Literal("testnet"), Type.Literal("local")]),
    rpcUrl: Type.String(),
    latestLedger: Nullable(Type.Integer()),
    keeper: Type.Object({ running: Type.Boolean(), paused: Type.Boolean(), lastLoopLedger: Nullable(Type.Integer()), leader: Type.Boolean() }),
    discovery: Type.Object({ cursor: U64, nextMarketId: Nullable(U64), lastScanLedger: Nullable(Type.Integer()) }),
    submitter: Type.Object({ address: Type.String(), xlmBalance: Nullable(Stroops) }),
    feeWallet: Type.Object({ address: Type.String(), registered: Nullable(Type.Boolean()) }),
    envelopeKey: Type.Union([Type.Literal("poc"), Type.Literal("custom")], { description: '"poc" = chave pública dos POCs, só para teste (OP-10)' }),
    versions: Type.Object({ service: Type.String(), contracts: Type.String() }),
    markets: Type.Record(Type.String(), Type.Integer()),
    openAlerts: Type.Integer(),
  },
  { $id: "OperatorStatus" },
);

export const MarketSummaryT = Type.Object(
  {
    marketId: U64,
    address: Type.String(),
    seller: Type.String(),
    status: MarketStatusT,
    supported: Type.Boolean(),
    totalQuotas: Type.Integer(),
    minPricePerQuota: Type.String({ description: "parâmetro PÚBLICO do mercado (preço mínimo por cota)" }),
    bidCount: Type.Integer(),
    demand: Type.Integer({ description: "Σ requested_quantity (público)" }),
    closeLedger: Type.Integer(),
    finalizeByLedger: Type.Integer(),
    estimatedCloseAt: Nullable(Type.String({ description: "só exibição: (closeLedger − ledger atual) × segundos por ledger (OP-22)" })),
    nextCheckLedger: Nullable(Type.Integer()),
    lastSyncedLedger: Nullable(Type.Integer()),
  },
  { $id: "MarketSummary" },
);

export const BidViewT = Type.Object({
  bidIndex: Type.Integer(),
  bidder: Type.String(),
  participantId: Type.Integer(),
  requestedQuantity: Type.Integer(),
  filledQuantity: Type.Integer(),
  status: BidStatusT,
  delegationLive: Nullable(Type.Boolean()),
  quarantined: Type.Boolean(),
});

export const MarketDetailT = Type.Composite(
  [
    MarketSummaryT,
    Type.Object({
      quotaAsset: Type.String(),
      finalizationGraceLedgers: Type.Integer(),
      contractsVersion: Nullable(Type.String()),
      allocation: Type.Union([Type.Array(Type.Integer()), Type.Null()], { description: "filled por bid_index, depois do Finalized (público on-chain)" }),
      unsold: Nullable(Type.Integer()),
      bids: Type.Array(BidViewT),
    }),
  ],
  { $id: "MarketDetail" },
);

export const ActionViewT = Type.Object(
  {
    id: Type.Integer(),
    kind: Type.String(),
    bidIndex: Nullable(Type.Integer()),
    ledger: Type.Integer(),
    outcome: Type.Union(["ok", "already_settled", "retry", "failed", "quarantined"].map((s) => Type.Literal(s))),
    code: Nullable(Type.String()),
    txHash: Nullable(Type.String()),
    feeCharged: Nullable(Stroops),
    cpuInsns: Nullable(Type.Integer()),
    at: Type.String(),
  },
  { $id: "ActionView" },
);

export const AlertViewT = Type.Object(
  {
    id: Type.Integer(),
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")]),
    kind: Type.String(),
    marketId: Nullable(U64),
    bidIndex: Nullable(Type.Integer()),
    message: Type.String(),
    at: Type.String(),
    ackedAt: Nullable(Type.String()),
  },
  { $id: "AlertView" },
);

export const RegisterDataT = Type.Object(
  {
    marketId: U64,
    address: Type.String({ description: "endereço PREVISTO da Auction; vale o que o create_market devolver" }),
    registerData: Type.String({ description: "base64; o mesmo para todo mercado do token (D-02)" }),
  },
  { $id: "RegisterData" },
);

export const PageQueryT = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  cursor: Type.Optional(Type.String({ pattern: "^[0-9]{1,20}$" })),
});

export const MarketsQueryT = Type.Composite([
  PageQueryT,
  Type.Object({
    status: Type.Optional(Type.String({ description: "lista separada por vírgula, ex.: Open,Closed", pattern: "^[A-Za-z,]+$" })),
    supported: Type.Optional(Type.Boolean()),
  }),
]);

export const AlertsQueryT = Type.Composite([
  PageQueryT,
  Type.Object({
    open: Type.Optional(Type.Boolean()),
    severity: Type.Optional(Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")])),
  }),
]);

export const MarketIdParamsT = Type.Object({ marketId: U64 });
export const AlertIdParamsT = Type.Object({ id: Type.Integer({ minimum: 1 }) });

export const page = <T extends Parameters<typeof Type.Array>[0]>(item: T) => Type.Object({ items: Type.Array(item), next: Type.Union([Type.String(), Type.Null()]) });

export type OperatorStatusBody = Static<typeof OperatorStatusT>;
export type MarketSummaryBody = Static<typeof MarketSummaryT>;
export type MarketDetailBody = Static<typeof MarketDetailT>;
export type MarketsQuery = Static<typeof MarketsQueryT>;
export type AlertsQuery = Static<typeof AlertsQueryT>;
export type PageQuery = Static<typeof PageQueryT>;
