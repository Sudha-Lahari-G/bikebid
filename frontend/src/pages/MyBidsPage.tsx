import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Crown, Gavel, TrendingDown, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BikeArt } from "../components/BikeArt";
import { Countdown, EmptyState, LivePrice, Skeleton, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { formatINR } from "../lib/format";
import type { MyAuction } from "../lib/types";

type Group = "active" | "won" | "lost";

function outcome(row: MyAuction) {
  const { auction, is_leading, is_winner } = row;
  if (auction.status === "live" || auction.status === "scheduled") {
    return is_leading
      ? { label: "Winning", tone: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25", icon: Crown }
      : { label: "Outbid", tone: "text-amber-300 bg-amber-500/10 ring-amber-500/25", icon: TrendingDown };
  }
  if (is_winner) return { label: "Won", tone: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25", icon: Trophy };
  return { label: auction.status === "cancelled" ? "Cancelled" : "Lost", tone: "text-zinc-400 bg-white/5 ring-white/10", icon: XCircle };
}

export function MyBidsPage() {
  const [group, setGroup] = useState<Group>("active");
  const query = useQuery({ queryKey: ["me", "auctions"], queryFn: api.myAuctions });
  const rows = query.data ?? [];

  const groups: Record<Group, MyAuction[]> = {
    active: rows.filter((r) => r.auction.status === "live" || r.auction.status === "scheduled"),
    won: rows.filter((r) => r.is_winner),
    lost: rows.filter((r) => (r.auction.status === "ended" || r.auction.status === "cancelled") && !r.is_winner),
  };
  const winning = groups.active.filter((r) => r.is_leading).length;

  return (
    <div className="animate-fade-up">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">My bids</h1>
        <p className="mt-1 text-zinc-400">Everything you've bid on, updating live.</p>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Active auctions", value: groups.active.length, sub: `${winning} winning` },
          { label: "Bikes won", value: groups.won.length, sub: formatINR(groups.won.reduce((s, r) => s + r.auction.current_price, 0)) + " total" },
          { label: "Auctions joined", value: rows.length, sub: "all time" },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className="text-xs uppercase tracking-wider text-zinc-500">{s.label}</div>
            <div className="mt-1 font-display text-3xl font-bold">{query.isLoading ? "–" : s.value}</div>
            <div className="text-sm text-zinc-400">{s.sub}</div>
          </div>
        ))}
      </div>

      <div role="tablist" className="mb-5 flex gap-1 rounded-2xl border border-white/[0.06] bg-ink-900/70 p-1 sm:w-fit">
        {(
          [
            ["active", "Active"],
            ["won", "Won"],
            ["lost", "Past"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={group === id}
            onClick={() => setGroup(id)}
            className={clsx(
              "flex-1 rounded-xl px-4 py-2 text-sm font-medium transition sm:flex-none",
              group === id ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {label} <span className="ml-1 text-xs text-zinc-500">{groups[id].length}</span>
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : groups[group].length === 0 ? (
        <EmptyState
          icon={<Gavel className="h-8 w-8" />}
          title={group === "active" ? "No active bids" : group === "won" ? "No wins yet" : "Nothing here yet"}
          action={
            <Link to="/" className="btn-primary">
              Browse live auctions
            </Link>
          }
        >
          {group === "won" ? "Your winning bikes will show up here." : "Find a bike you love and place your first bid."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {groups[group].map((row) => {
            const o = outcome(row);
            const a = row.auction;
            return (
              <li key={a.id}>
                <Link
                  to={`/auctions/${a.id}`}
                  className="card flex items-center gap-4 overflow-hidden p-3 pr-5 transition hover:border-white/15"
                >
                  <BikeArt motorcycle={a.motorcycle} className="hidden aspect-[4/3] w-36 shrink-0 rounded-xl sm:block" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.status} />
                      <span className={clsx("chip ring-1 ring-inset", o.tone)}>
                        <o.icon className="h-3 w-3" /> {o.label}
                      </span>
                    </div>
                    <div className="truncate font-display font-semibold">{a.title}</div>
                    <div className="text-sm text-zinc-400">
                      Your top bid <span className="font-medium text-zinc-200 tabular">{formatINR(row.my_highest_bid)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-zinc-500">{a.status === "live" ? "Current" : "Final"}</div>
                    <div className="font-display text-lg font-semibold">
                      <LivePrice amount={a.current_price} />
                    </div>
                    {a.status === "live" && <Countdown auction={a} className="text-xs" />}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
