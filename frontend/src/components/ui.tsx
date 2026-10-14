import clsx from "clsx";
import { Clock, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNow } from "../lib/clock";
import { formatINR, formatRemaining, remaining } from "../lib/format";
import type { Auction, AuctionStatus } from "../lib/types";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className ?? "h-4 w-4")} aria-hidden="true" />;
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={clsx("relative inline-flex h-2 w-2", className)} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-flame-500" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-flame-500" />
    </span>
  );
}

const STATUS_STYLE: Record<AuctionStatus, string> = {
  live: "bg-flame-500/15 text-flame-300 ring-1 ring-inset ring-flame-500/30",
  scheduled: "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/25",
  ended: "bg-zinc-500/15 text-zinc-300 ring-1 ring-inset ring-white/10",
  cancelled: "bg-red-500/10 text-red-300 ring-1 ring-inset ring-red-500/25",
};
const STATUS_LABEL: Record<AuctionStatus, string> = {
  live: "Live",
  scheduled: "Upcoming",
  ended: "Ended",
  cancelled: "Cancelled",
};

export function StatusBadge({ status, className }: { status: AuctionStatus; className?: string }) {
  return (
    <span className={clsx("chip", STATUS_STYLE[status], className)}>
      {status === "live" && <LiveDot />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Countdown to the relevant moment: start for upcoming auctions, end for live ones. */
export function Countdown({ auction, className, big }: { auction: Auction; className?: string; big?: boolean }) {
  const now = useNow();
  if (auction.status === "ended" || auction.status === "cancelled") {
    return <span className={clsx("text-zinc-400", className)}>{auction.status === "ended" ? "Ended" : "Cancelled"}</span>;
  }
  const target = auction.status === "scheduled" ? auction.starts_at : auction.ends_at;
  const r = remaining(target, now);
  const urgent = auction.status === "live" && r.totalMs < 2 * 60_000;
  const critical = auction.status === "live" && r.totalMs < 30_000;
  const label = auction.status === "scheduled" ? "Starts in" : r.totalMs > 0 ? "Ends in" : "Closing…";

  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 tabular", className, {
        "text-zinc-300": !urgent,
        "text-amber-300": urgent && !critical,
        "animate-pulse text-red-400": critical,
      })}
      aria-live={critical ? "polite" : "off"}
    >
      {!big && <Clock className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />}
      <span className={clsx(big ? "text-xs uppercase tracking-wider text-zinc-400" : "sr-only")}>{label}</span>
      <span className={clsx("font-semibold", big && "font-display text-2xl")}>
        {r.totalMs > 0 ? formatRemaining(r) : "—"}
      </span>
    </span>
  );
}

/** Price that briefly glows when it changes (not on first render). */
export function LivePrice({ amount, className }: { amount: number; className?: string }) {
  const previous = useRef(amount);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (previous.current !== amount) {
      previous.current = amount;
      setFlashKey((k) => k + 1);
    }
  }, [amount]);
  return (
    <span key={flashKey} className={clsx("inline-block tabular", flashKey > 0 && "animate-flash", className)}>
      {formatINR(amount)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-xl bg-white/[0.04]", className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 text-zinc-400">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-zinc-400">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}
