import { cn } from "@/lib/cn";

export function DemandBar({
  demand,
  totalQuotas,
  className,
  compact = false,
}: {
  demand: number;
  totalQuotas: number;
  className?: string;
  compact?: boolean;
}) {
  const ratio = totalQuotas === 0 ? 0 : Math.min(1, demand / totalQuotas);
  return (
    <div className={className}>
      <div
        className={cn("relative overflow-hidden rounded-full bg-sunken", compact ? "h-1" : "h-1.5")}
        role="img"
        aria-label={`Demand for ${demand} quotas out of ${totalQuotas} offered`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(demand > 0 ? 2 : 0, ratio * 100)}%` }}
        />
      </div>
      {!compact && (
        <div className="mt-1.5 flex items-center justify-between text-[12px] text-ink-3">
          <span>
            <span className="numeric font-medium text-ink-2">{demand.toLocaleString("en-US")}</span> of{" "}
            {totalQuotas.toLocaleString("en-US")} quotas requested
          </span>
          <span>{Math.round(ratio * 100)}%</span>
        </div>
      )}
    </div>
  );
}
