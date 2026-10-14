import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, Ban, Eye, Gavel, IndianRupee, Pencil, Plus, Search, Timer, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Countdown, EmptyState, Skeleton, Spinner, StatusBadge } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatINR, formatINRShort } from "../lib/format";
import type { AdminAuction, AuctionStatus } from "../lib/types";

function Stat({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={clsx("card p-5", accent && "border-flame-500/20 bg-gradient-to-br from-flame-500/10 to-transparent")}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-zinc-500">
        {label}
        <span className={clsx("rounded-lg p-1.5", accent ? "bg-flame-500/15 text-flame-300" : "bg-white/[0.04] text-zinc-400")}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-bold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-sm text-zinc-400">{sub}</div>}
    </div>
  );
}

function CancelDialog({ auction, onClose }: { auction: AdminAuction; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const cancel = useMutation({
    mutationFn: () => api.admin.cancel(auction.id, reason),
    onSuccess: () => {
      toast.success(`“${auction.title}” was cancelled`);
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["auctions"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/10 bg-ink-900 p-0 text-zinc-100 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <form
        method="dialog"
        className="p-6"
        onSubmit={(e) => {
          e.preventDefault();
          cancel.mutate();
        }}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-xl font-semibold">Cancel auction?</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          <span className="text-zinc-200">{auction.title}</span>{" "}
          {auction.bid_count > 0
            ? `has ${auction.bid_count} bids. Bidders will see that it was withdrawn and no sale will happen.`
            : "will be withdrawn. This can't be undone."}
        </p>
        <label htmlFor="reason" className="label mt-5">
          Reason (internal, logged)
        </label>
        <textarea
          id="reason"
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input resize-none"
          placeholder="e.g. Seller withdrew the listing"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Keep it
          </button>
          <button type="submit" className="btn-danger" disabled={cancel.isPending}>
            {cancel.isPending ? <Spinner /> : <Ban className="h-4 w-4" />} Cancel auction
          </button>
        </div>
      </form>
    </dialog>
  );
}

const FILTERS: { id: AuctionStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "scheduled", label: "Upcoming" },
  { id: "ended", label: "Ended" },
  { id: "cancelled", label: "Cancelled" },
];

export function AdminDashboard() {
  const [filter, setFilter] = useState<AuctionStatus | "all">("all");
  const [q, setQ] = useState("");
  const [cancelling, setCancelling] = useState<AdminAuction | null>(null);

  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: api.admin.stats, refetchInterval: 15_000 });
  const list = useQuery({
    queryKey: ["admin", "auctions", filter, q],
    queryFn: () => api.admin.auctions({ status: filter === "all" ? undefined : [filter], q: q || undefined, limit: 100 }),
    placeholderData: keepPreviousData,
  });
  const s = stats.data;

  return (
    <div className="animate-fade-up">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Admin dashboard</h1>
          <p className="mt-1 text-zinc-400">Manage listings and watch the marketplace in real time.</p>
        </div>
        <Link to="/admin/auctions/new" className="btn-primary">
          <Plus className="h-4 w-4" /> New auction
        </Link>
      </header>

      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat accent icon={<Gavel className="h-4 w-4" />} label="Live now" value={s?.auctions_by_status.live ?? "–"} sub={`${s?.auctions_by_status.scheduled ?? 0} upcoming`} />
        <Stat icon={<Activity className="h-4 w-4" />} label="Bids · last hour" value={s?.bids_last_hour ?? "–"} sub={`${s?.total_bids ?? 0} all time`} />
        <Stat icon={<IndianRupee className="h-4 w-4" />} label="Gross sales" value={s ? formatINRShort(s.gross_sales) : "–"} sub={`${s?.auctions_by_status.ended ?? 0} auctions closed`} />
        <Stat icon={<Users className="h-4 w-4" />} label="Accounts" value={s?.users ?? "–"} sub="registered users" />
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  filter === f.id ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {f.label}
                {f.id !== "all" && s && <span className="ml-1.5 text-xs text-zinc-500">{s.auctions_by_status[f.id]}</span>}
              </button>
            ))}
          </div>
          <label className="relative lg:w-72">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input py-2 pl-9" placeholder="Search listings" />
          </label>
        </div>

        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !list.data?.items.length ? (
          <div className="p-6">
            <EmptyState icon={<Gavel className="h-8 w-8" />} title="No auctions match" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-medium">Listing</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Reserve</th>
                  <th className="px-4 py-3 text-right font-medium">Bids</th>
                  <th className="px-4 py-3 font-medium">Timing</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className={clsx(list.isPlaceholderData && "opacity-60")}>
                {list.data.items.map((a) => (
                  <tr key={a.id} className="border-b border-white/[0.04] transition hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{a.title}</div>
                      <div className="text-xs text-zinc-500">
                        #{a.id} · {a.motorcycle.location}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular">{formatINR(a.current_price)}</td>
                    <td className="px-4 py-3 text-right tabular">
                      {a.reserve_price ? (
                        <span className={a.reserve_met ? "text-emerald-300" : "text-zinc-400"}>{formatINR(a.reserve_price)}</span>
                      ) : (
                        <span className="text-zinc-600">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular">{a.bid_count}</td>
                    <td className="px-4 py-3 text-xs">
                      {a.status === "live" || a.status === "scheduled" ? (
                        <Countdown auction={a} />
                      ) : (
                        <span className="text-zinc-500">{formatDateTime(a.ended_at ?? a.ends_at)}</span>
                      )}
                      {a.extension_count > 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-amber-300">
                          <Timer className="h-3 w-3" />×{a.extension_count}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link to={`/auctions/${a.id}`} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white" title="View">
                          <Eye className="h-4 w-4" />
                        </Link>
                        {a.status === "scheduled" && (
                          <Link
                            to={`/admin/auctions/${a.id}/edit`}
                            className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        )}
                        {(a.status === "live" || a.status === "scheduled") && (
                          <button
                            onClick={() => setCancelling(a)}
                            className="rounded-lg p-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
                            title="Cancel"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cancelling && <CancelDialog auction={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
