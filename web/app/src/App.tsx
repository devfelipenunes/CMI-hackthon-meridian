import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { ConfigProvider, useConfig } from "@/config/ConfigProvider";
import { CmiProvider } from "@/sdk/CmiProvider";
import { NetworkProvider } from "@/sdk/NetworkProvider";
import { Button, ButtonLink } from "@/ui/Button";
import { EmptyState } from "@/ui/Feedback";
import { AppShell } from "@/ui/AppShell";
import { Toaster } from "@/ui/Toaster";
import { WalletProvider } from "@/wallet/WalletProvider";
import { CompanyPage } from "@/pages/CompanyPage";
import { CompanyMarketPage } from "@/pages/CompanyMarketPage";
import { CreateMarketPage } from "@/pages/CreateMarketPage";
import { HomePage } from "@/pages/HomePage";
import { InvestorPage } from "@/pages/InvestorPage";
import { BidPage } from "@/pages/BidPage";
import { MarketPage } from "@/pages/MarketPage";
import { WalletPage } from "@/pages/WalletPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 4_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {

  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          title="This screen failed to load"
          detail="Something failed while mounting the page. Reloading resets the screen state; your wallet is not affected."
          mono="screen error"
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      </div>
    );
  }
}

function ScrollToTop(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        title="Page not found"
        detail="This address does not exist in this app. The auction list is still on the home page."
        mono="404"
        action={<ButtonLink to="/">View auctions</ButtonLink>}
      />
    </div>
  );
}

function ConfiguredApp() {
  const config = useConfig();
  return (
    <WalletProvider passphrase={config.passphrase}>
      <NetworkProvider>
        <CmiProvider>
          <BrowserRouter>
            <ScrollToTop />
            <ScreenBoundary>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="market/:marketId" element={<MarketPage />} />
                  <Route path="market/:marketId/bid" element={<BidPage />} />
                  <Route path="company" element={<CompanyPage />} />
                  <Route path="company/new" element={<CreateMarketPage />} />
                  <Route path="company/market/:marketId" element={<CompanyMarketPage />} />
                  <Route path="investor" element={<InvestorPage />} />
                  <Route path="wallet" element={<WalletPage />} />
                  <Route path="account" element={<Navigate to="/wallet" replace />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </ScreenBoundary>
          </BrowserRouter>
          <Toaster />
        </CmiProvider>
      </NetworkProvider>
    </WalletProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <ConfiguredApp />
      </ConfigProvider>
    </QueryClientProvider>
  );
}
