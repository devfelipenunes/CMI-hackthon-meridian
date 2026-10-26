import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-6 pb-6", className)}>
      <div className="max-w-prose">
        {eyebrow !== undefined && <p className="label mb-2">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">{title}</h1>
        {description !== undefined && <p className="mt-2 text-sm leading-relaxed text-ink-2 sm:text-[15px]">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
  id,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("py-6", className)} aria-labelledby={title === undefined ? undefined : `${id ?? title}-heading`}>
      {(title !== undefined || aside !== undefined) && (
        <div className="mb-3 flex items-end justify-between gap-4">
          {title !== undefined && (
            <h2 id={id === undefined ? `${title}-heading` : `${id}-heading`} className="text-[15px] font-semibold tracking-tight">
              {title}
            </h2>
          )}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function DefinitionList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("divide-y divide-line border-y border-line", className)}>{children}</dl>;
}

export function DefinitionRow({ term, children, hint }: { term: string; children: ReactNode; hint?: string | undefined }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3">
      <dt className="text-sm text-ink-2">
        {term}
        {hint !== undefined && <span className="mt-0.5 block text-[12px] text-ink-3">{hint}</span>}
      </dt>
      <dd className="text-right text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

export function InlineNote({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <p
      className={cn(
        "text-[13px] leading-relaxed",
        tone === "accent" ? "border-l-2 border-accent/60 pl-3 text-ink-2" : "text-ink-3",
      )}
    >
      {children}
    </p>
  );
}
