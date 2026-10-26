import { AlertCircle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { errorTextFrom } from "@/domain/errors";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export function ErrorNotice({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const text = errorTextFrom(error);
  return (
    <div role="alert" className={cn("flex items-start gap-3 border-l-2 border-danger bg-danger/[0.04] px-4 py-3", className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{text.title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{text.detail}</p>
      </div>
      {onRetry !== undefined && (
        <Button variant="ghost" size="sm" onClick={onRetry} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  mono,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  mono?: string;
}) {
  return (
    <div className="border-y border-line px-6 py-14 text-center">
      {mono !== undefined && <p className="numeric mb-4 text-[11px] tracking-[0.2em] text-ink-3">{mono}</p>}
      <p className="text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-2">{detail}</p>
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line border-y border-line" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 py-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
