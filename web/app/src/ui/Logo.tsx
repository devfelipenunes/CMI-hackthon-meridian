import { cn } from "@/lib/cn";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("h-8 w-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <path d="M9.5 11.2 16 17l6.5-5.8" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-surface" />
      <path d="M9.5 20.6h9.2" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-accent" />
      <circle cx="22.4" cy="20.6" r="1.7" className="fill-accent" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-[-0.01em]">CMI</span>
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">Auctions</span>
        </span>
      )}
    </span>
  );
}
