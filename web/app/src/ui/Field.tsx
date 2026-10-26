import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {optional === true && <span className="ml-1.5 font-normal text-ink-3">(optional)</span>}
        </label>
      </div>
      {children}
      {error !== undefined ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, suffix, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full rounded-control border bg-surface px-3 text-sm text-ink placeholder:text-ink-3/70",
          "transition-colors duration-150 hover:border-ink-3/60 focus:border-primary focus:outline-none",
          "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3",
          invalid ? "border-danger" : "border-line-strong",
          suffix !== undefined && "pr-16",
          className,
        )}
        {...rest}
      />
      {suffix !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-ink-3">
          {suffix}
        </span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid = false, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "min-h-24 w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-3/70",
          "transition-colors duration-150 hover:border-ink-3/60 focus:border-primary focus:outline-none",
          invalid ? "border-danger" : "border-line-strong",
          className,
        )}
        {...rest}
      />
    );
  },
);
