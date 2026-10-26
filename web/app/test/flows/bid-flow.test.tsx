import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BidPage } from "@/pages/BidPage";
import { formatXlm, formatXlmWithUnit } from "@/domain/amount";

import { CLOSE, bidScenario, flowResources, marketView } from "./support/bid-scenario";

const state = vi.hoisted(() => ({
  resources: null as unknown,
  market: null as unknown,
  wallet: null as unknown,
}));

vi.mock("@/sdk/useMarketId", () => ({ useMarketId: () => 1n }));
vi.mock("@/sdk/useMarkets", () => ({
  useMarket: () => ({ data: state.market, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/sdk/NetworkProvider", () => ({
  useNetwork: () => ({ chain: {}, ledger: 100, anchor: null }),
  useNow: () => 0,
}));
vi.mock("@/sdk/quota", () => ({ hasQuotaTrustline: async () => true }));
vi.mock("@/config/ConfigProvider", () => ({
  useConfig: () => ({ contracts: { token: "CDD7G3P4RLDV3UPE4TH7N3HMR64OTJNUC7TTJVOT6L7IUHVSXQFVCVM6" }, horizonUrl: "", passphrase: "" }),
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

const PRICE = 777_777_777n;
const QUANTITY = 4;
const TOTAL = PRICE * BigInt(QUANTITY);
const PRICE_TEXT = formatXlm(PRICE);
const TOTAL_TEXT = formatXlm(TOTAL);

type Scenario = Awaited<ReturnType<typeof bidScenario>>;

function renderFlow(s: Scenario) {
  state.resources = flowResources(s);
  state.market = marketView(s);
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
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/market/${s.marketId.toString()}/bid`]}>
        <BidPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

async function fillBid(user: ReturnType<typeof userEvent.setup>, price: string): Promise<void> {
  await user.type(screen.getByLabelText("Price per quota"), price);
  await user.type(screen.getByLabelText("Quota quantity"), String(QUANTITY));
}

function sinks(queryClient: QueryClient): unknown[] {
  return [
    document.body.textContent,
    localStorage,
    sessionStorage,
    location.href,
    [...queryClient.getQueryCache().getAll()],
  ];
}

describe("fluxo do lance", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it("abaixo do piso não chama o SDK nem prova nada", async () => {
    const s = await bidScenario();
    const user = userEvent.setup();
    renderFlow(s);

    await fillBid(user, "0.00004");

    expect(await screen.findByText(/Below the floor of 0\.00005 XLM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare bid" })).toBeDisabled();
    expect(s.log.writes()).toEqual([]);
    expect(s.prover.proved).toEqual([]);
  });

  it("prepara, confirma e envia na ordem do SDK; o preço some depois", async () => {
    const s = await bidScenario();
    const user = userEvent.setup();
    const { queryClient } = renderFlow(s);

    await fillBid(user, "77.7777777");
    const prepare = screen.getByRole("button", { name: "Prepare bid" });
    await waitFor(() => expect(prepare).toBeEnabled());
    await user.click(prepare);

    const dialog = await screen.findByRole("dialog", { name: "Confirm bid" });
    expect(dialog).toHaveTextContent(`${PRICE_TEXT} XLM`);
    expect(dialog).toHaveTextContent(`${TOTAL_TEXT} XLM`);

    expect(s.prover.proved.map((p) => p.circuit)).toEqual(["bid_validity", "set_spender"]);
    expect(s.log.writes()).not.toContain("token.set_spender");

    s.log.clear();
    await user.click(screen.getByRole("button", { name: "Sign and send" }));

    expect(await screen.findByText("Bid #0 sent")).toBeInTheDocument();
    expect(s.log.writes()).toEqual(["token.set_spender", "auction.submit_bid"]);
    expect(document.body.textContent).not.toContain(PRICE_TEXT);
    expect(document.body.textContent).not.toContain(TOTAL_TEXT);
    assertNoSecretLeak([PRICE, TOTAL], sinks(queryClient));
    assertNoSecretLeak([PRICE, TOTAL], consoleSpies.map((spy) => spy.mock.calls));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("erro depois do travamento oferece a recuperação do colateral", async () => {
    const s = await bidScenario();
    const user = userEvent.setup();
    const { queryClient } = renderFlow(s);

    await fillBid(user, "77.7777777");
    const prepare = screen.getByRole("button", { name: "Prepare bid" });
    await waitFor(() => expect(prepare).toBeEnabled());
    await user.click(prepare);
    await screen.findByRole("dialog", { name: "Confirm bid" });

    s.log.clear();

    s.clock.advanceTo(CLOSE);
    await user.click(screen.getByRole("button", { name: "Sign and send" }));

    expect(await screen.findByText("Bidding closed")).toBeInTheDocument();
    expect(s.log.writes()).toEqual(["token.set_spender", "auction.submit_bid"]);

    const noDialog = sinks(queryClient).filter((sink) => sink !== document.body.textContent);
    assertNoSecretLeak([PRICE, TOTAL], [...noDialog, consoleSpies.map((spy) => spy.mock.calls)]);

    expect(document.body.textContent).not.toContain("submit_bid rejected");

    s.log.clear();
    await user.click(screen.getByRole("button", { name: "Recover locked collateral" }));
    await waitFor(() => expect(s.log.writes()).toEqual(["token.revoke_spender"]));
    expect(await s.token.isSpender(s.me.address, s.address)).toBe(false);
  });

  it("avisa quando o último depósito revela o preço", async () => {
    const s = await bidScenario({ lastDeposit: TOTAL });
    const user = userEvent.setup();
    renderFlow(s);

    await fillBid(user, "77.7777777");
    const prepare = screen.getByRole("button", { name: "Prepare bid" });
    await waitFor(() => expect(prepare).toBeEnabled());
    await user.click(prepare);

    const dialog = await screen.findByRole("dialog", { name: "Confirm bid" });
    expect(dialog).toHaveTextContent(/Your latest deposit has exactly the amount of this bid/);
    expect(dialog).toHaveTextContent(`${formatXlmWithUnit(PRICE)}`);
  });
});
