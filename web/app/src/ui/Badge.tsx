import type { ReactNode } from "react";

import type { Tone } from "@/domain/market";
import { cn } from "@/lib/cn";

const tones: Record<Tone, { dot: string; text: string; bg: string }> = {
  neutral: { dot: "bg-ink-3", text: "text-ink-2", bg: "bg-sunken" },
  live: { dot: "bg-accent", text: "text-accent", bg: "bg-accent/[0.08]" },
  progress: { dot: "bg-primary", text: "text-primary", bg: "bg-primary-soft" },
  success: { dot: "bg-success", text: "text-success", bg: "bg-success/[0.08]" },
  danger: { dot: "bg-danger", text: "text-danger", bg: "bg-danger/[0.08]" },
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5",
        t.bg,
        t.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot, tone === "live" && "animate-pulse")} aria-hidden />
      {children}
    </span>
  );
}
