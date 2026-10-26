import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

export function shortAddress(address: string, size = 4): string {
  if (address.length <= size * 2 + 1) return address;
  return `${address.slice(0, size + 1)}…${address.slice(-size)}`;
}

export function Address({
  value,
  label,
  size = 4,
  copy = false,
  explorer = false,
  className,
}: {
  value: string;
  label?: string;
  size?: number;
  copy?: boolean;
  explorer?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const doCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {label !== undefined && <span className="text-ink-3">{label}</span>}
      <abbr title={value} className="numeric cursor-help whitespace-nowrap text-[12.5px] text-ink-2 no-underline">
        {shortAddress(value, size)}
      </abbr>
      {copy && (
        <button
          type="button"
          onClick={() => void doCopy()}
          aria-label={copied ? "Address copied" : "Copy address"}
          className="rounded p-0.5 text-ink-3 transition-colors hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
      )}
      {explorer && (
        <a
          href={`https://stellar.expert/explorer/testnet/contract/${value}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Open in Stellar Expert"
          className="rounded p-0.5 text-ink-3 transition-colors hover:text-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </span>
  );
}
