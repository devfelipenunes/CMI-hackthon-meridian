import { Building2, Gavel, TicketCheck, Wallet } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import type { Role } from "@/domain/market";
import { cn } from "@/lib/cn";
import { useNetwork } from "@/sdk/NetworkProvider";
import { useWallet } from "@/wallet/WalletProvider";
import { WalletButton } from "@/wallet/WalletButton";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { to: "/", label: "Auctions", icon: Gavel, end: true },
  { to: "/company", label: "Company", icon: Building2, end: false },
  { to: "/investor", label: "My bids", icon: TicketCheck, end: false },
  { to: "/wallet", label: "Wallet", icon: Wallet, end: false },
] as const;

function RailLink({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150",
          isActive ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-sunken hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
          {label}
        </>
      )}
    </NavLink>
  );
}

function ModeSwitch() {
  const { mode, setMode, address } = useWallet();
  if (address === null) return null;
  const option = (value: Role, label: string): JSX.Element => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={cn(
        "flex-1 rounded-[7px] px-2 py-1 text-[12px] font-semibold transition-colors duration-150",
        mode === value ? "bg-surface text-ink shadow-sheet" : "text-ink-3 hover:text-ink-2",
      )}
    >
      {label}
    </button>
  );
  return (
    <div>
      <p className="label mb-1.5 px-0.5">Mode</p>
      <div className="flex gap-0.5 rounded-[9px] border border-line bg-sunken/70 p-0.5">
        {option("investor", "Investor")}
        {option("company", "Company")}
      </div>
    </div>
  );
}

function LedgerStrip() {
  const { ledger, ledgerError } = useNetwork();
  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", ledgerError ? "bg-danger" : "bg-accent")} aria-hidden />
        Testnet
      </span>
      <span className="numeric" title="Latest ledger seen; times on screen are estimates">
        {ledger === null ? (ledgerError ? "ledger unavailable" : "reading ledger…") : `ledger ${ledger.toLocaleString("en-US")}`}
      </span>
    </div>
  );
}

export function AppShell() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-sunken/35 px-3.5 py-5 lg:flex">
        <NavLink to="/" className="mb-7 px-1.5" aria-label="CMI Auctions — home">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <RailLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="mt-auto space-y-4 px-0.5">
          <ModeSwitch />
          <LedgerStrip />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg px-4 lg:hidden">
          <NavLink to="/" aria-label="CMI Auctions — home">
            <Logo />
          </NavLink>
          <div className="flex items-center gap-1.5">
            <WalletButton />
            <ThemeToggle />
          </div>
        </header>

        <div className="hidden items-center justify-between border-b border-line px-8 py-2.5 lg:flex">
          <LedgerStrip />
          <div className="flex items-center gap-2">
            <WalletButton />
            <ThemeToggle />
          </div>
        </div>

        <main className="mx-auto w-full max-w-page flex-1 px-5 pb-28 pt-7 sm:px-8 lg:px-8 lg:pb-16 lg:pt-9">
          <Outlet />
        </main>

        <footer className="mx-auto w-full max-w-page px-5 pb-8 text-[11.5px] leading-relaxed text-ink-3 sm:px-8">
          Confidential quota auctions on Stellar Testnet. Market data is public; bids, prices and balances stay
          confidential in your browser.
        </footer>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors",
                isActive ? "text-primary" : "text-ink-3",
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
