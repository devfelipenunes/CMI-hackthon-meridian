import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { MarketView } from "@zolvency-cmi/client";
import type { MarketStatus } from "@zolvency-cmi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvestorPage } from "@/pages/InvestorPage";

import { CLOSE, bidScenario, flowResources, marketView } from "./support/bid-scenario";

const state = vi.hoisted(() => ({
  resources: null as unknown,
  markets: [] as unknown[],
  wallet: null as unknown,
  ledger: 0,
}));

vi.mock("@/sdk/useMarkets", () => ({
  useMarkets: () => ({ data: state.markets, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/sdk/NetworkProvider", () => ({
  useNetwork: () => ({ chain: {}, ledger: state.ledger, anchor: null }),
  useNow: () => 0,
}));
vi.mock("@/wallet/WalletProvider", () => ({ useWallet: () => state.wallet }));
vi.mock("@/sdk/CmiProvider", () => ({
  useCmi: () => state.resources,
  useAccountStatus: () => ({
    data: { onChain: true, hasKey: true, backupRequired: false, openings: true },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

type Scenario = Awaited<ReturnType<typeof bidScenario>>;

async function withBid(): Promise<Scenario> {
  const s = await bidScenario();
  const prepared = await s.client.bidder.prepareBid(s.marketId, 777_777_777n, 4);
  await s.client.bidder.placeBid(prepared);
  s.log.clear();
  return s;
}

async function expire(s: Scenario): Promise<number> {
  s.clock.advanceTo(CLOSE);
  await s.auction.closeMarket(s.me);
  const finalizeBy = (await s.auction.getFinalizeByLedger()) ?? CLOSE;
  s.clock.advanceTo(finalizeBy + 1);
  return finalizeBy;
}

function view(s: Scenario, status: MarketStatus, finalizeByLedger: number | null = null): MarketView {
  return { ...marketView(s), status, finalizeByLedger, bidCount: 1, demand: 4 };
}

function renderPage(s: Scenario, market: MarketView, ledger: number) {
  state.resources = flowResources(s);
  state.markets = [market];
  state.ledger = ledger;
  state.wallet = {
    address: s.me.address,
    kind: "dev",
    adapter: { address: s.me.address, signTransaction: async (input: string) => input },
    connecting: false,
    mode: "investor",
    setMode: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/investor"]}>
        <InvestorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RECOVER = "Recover collateral";

describe("meus lances: recuperar colateral", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it("recover button only when a live delegation exists: mercado cancelado devolve o colateral", async () => {
    const s = await withBid();
    const finalizeBy = await expire(s);
    await s.auction.cancelExpired(s.me);
    s.log.clear();
    const user = userEvent.setup();
    renderPage(s, view(s, "Cancelled", finalizeBy), finalizeBy + 1);

    const recover = await screen.findByRole("button", { name: RECOVER });
    await user.click(recover);

    expect(await screen.findByText("Collateral returned to the balance.")).toBeInTheDocument();
    expect(s.log.writes()).toEqual(["token.revoke_spender"]);
    expect(await s.token.delegation(s.me.address, s.address)).toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: RECOVER })).not.toBeInTheDocument());
  });

  it("recover button only when a live delegation exists: fechado e vencido sem finalização", async () => {
    const s = await withBid();
    const finalizeBy = await expire(s);
    renderPage(s, view(s, "Closed", finalizeBy), finalizeBy + 1);

    expect(await screen.findByRole("button", { name: RECOVER })).toBeInTheDocument();
  });

  it("recover button only when a live delegation exists: não aparece com o lance em jogo", async () => {
    const s = await withBid();
    renderPage(s, view(s, "Open"), CLOSE - 1);

    expect(await screen.findByText("4 quotas requested")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECOVER })).not.toBeInTheDocument();
  });

  it("recover button only when a live delegation exists: fechado dentro do prazo do operador", async () => {
    const s = await withBid();
    s.clock.advanceTo(CLOSE);
    await s.auction.closeMarket(s.me);
    const finalizeBy = (await s.auction.getFinalizeByLedger()) ?? CLOSE;
    renderPage(s, view(s, "Closed", finalizeBy), finalizeBy);

    expect(await screen.findByText("4 quotas requested")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECOVER })).not.toBeInTheDocument();
  });

  it("recover button only when a live delegation exists: sem delegação não há o que recuperar", async () => {
    const s = await withBid();
    const finalizeBy = await expire(s);
    await s.auction.cancelExpired(s.me);
    await s.client.bidder.recoverCollateral(s.marketId);
    s.log.clear();
    renderPage(s, view(s, "Cancelled", finalizeBy), finalizeBy + 1);

    expect(await screen.findByText("4 quotas requested")).toBeInTheDocument();

    await waitFor(() => expect(s.log.all()).toContain("token.get_spender_delegation"));
    expect(screen.queryByRole("button", { name: RECOVER })).not.toBeInTheDocument();
    expect(s.log.writes()).toEqual([]);
  });
});

const RECEIVE = "Receive refunds";
const REFUND = 30_000_000_000n;

describe("meus lances: painel de reembolsos", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it("refund panel shows the on-chain receiving balance and merges it", async () => {
    const s = await withBid();
    let receiving = REFUND;
    vi.spyOn(s.client.account, "balance").mockImplementation(async () => ({ spendable: s.deposit, receiving }));
    const merge = vi.spyOn(s.client.account, "merge").mockImplementation(async () => {
      receiving = 0n;
      return { hash: "merge", ledger: 1 } as Awaited<ReturnType<typeof s.client.account.merge>>;
    });
    const user = userEvent.setup();
    renderPage(s, view(s, "Open"), CLOSE - 1);

    expect(await screen.findByText("3,000 XLM")).toBeInTheDocument();
    expect(screen.getByText("to receive")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: RECEIVE }));

    expect(await screen.findByText("Refunds available in the confidential account.")).toBeInTheDocument();
    expect(merge).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("0 XLM")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: RECEIVE })).toBeDisabled();
  });

  it("refund panel ignores the refund history: nothing received, nothing to merge", async () => {
    const s = await withBid();
    vi.spyOn(s.client.account, "balance").mockResolvedValue({ spendable: s.deposit, receiving: 0n });

    vi.spyOn(s.client.bidder, "status").mockResolvedValue({ bidIndex: 0, status: "Settled", requested: 4, filled: 0, refund: REFUND });
    renderPage(s, view(s, "Settled"), CLOSE + 500);

    expect(await screen.findByText("3,000 XLM refunded")).toBeInTheDocument();
    expect(screen.getByText("0 XLM")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: RECEIVE })).toBeDisabled());
  });

  it("a pending bid in a cancelled auction is not awaiting allocation", async () => {
    const s = await withBid();
    const finalizeBy = await expire(s);
    await s.auction.cancelExpired(s.me);
    renderPage(s, view(s, "Cancelled", finalizeBy), finalizeBy + 1);

    expect(await screen.findByText("Auction cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting allocation")).not.toBeInTheDocument();
    expect(screen.queryByText(/still awaiting allocation/)).not.toBeInTheDocument();
  });

  it("a pending bid past the finalization deadline is not awaiting allocation", async () => {
    const s = await withBid();
    const finalizeBy = await expire(s);
    renderPage(s, view(s, "Closed", finalizeBy), finalizeBy + 1);

    expect(await screen.findByText("Settlement deadline passed")).toBeInTheDocument();
    expect(screen.queryByText(/still awaiting allocation/)).not.toBeInTheDocument();
  });

  it("a pending bid within the operator's window is still awaiting allocation", async () => {
    const s = await withBid();
    renderPage(s, view(s, "Open"), CLOSE - 1);

    expect(await screen.findByText("Awaiting allocation")).toBeInTheDocument();
    expect(screen.getByText(/still awaiting allocation/)).toBeInTheDocument();
  });
});
