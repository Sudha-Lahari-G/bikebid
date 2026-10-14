import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Bike, Search, ShieldCheck, Timer, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuctionCard } from "../components/AuctionCard";
import { BikeArt } from "../components/BikeArt";
import { Countdown, EmptyState, LiveDot, LivePrice, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AuctionStatus } from "../lib/types";

type Tab = "live" | "scheduled" | "ended";
const TABS: { id: Tab; label: string; sorts: { id: string; label: string }[] }[] = [
  {
    id: "live",
    label: "Live now",
    sorts: [
      { id: "ending_soon", label: "Ending soonest" },
      { id: "most_bids", label: "Most bids" },
      { id: "price_asc", label: "Price: low to high" },
      { id: "price_desc", label: "Price: high to low" },
    ],
  },
  {
    id: "scheduled",
    label: "Upcoming",
    sorts: [
      { id: "ending_soon", label: "Starting soonest" },
      { id: "price_asc", label: "Price: low to high" },
      { id: "price_desc", label: "Price: high to low" },
    ],
  },
  {
    id: "ended",
    label: "Results",
    sorts: [
      { id: "recently_ended", label: "Recently ended" },
      { id: "price_desc", label: "Highest sale" },
      { id: "most_bids", label: "Most bids" },
    ],
  },
];
const PAGE = 12;

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function useCount(status: AuctionStatus) {
  return useQuery({
    queryKey: ["auctions", "count", status],
    queryFn: () => api.auctions({ status: [status], limit: 1 }),
    select: (page) => page.total,
  });
}

function Hero({ liveCount }: { liveCount?: number }) {
  const { user } = useAuth();
  const spotlight = useQuery({
    queryKey: ["auctions", "spotlight"],
    queryFn: () => api.auctions({ status: ["live"], sort: "ending_soon", limit: 1 }),
  });
  const featured = spotlight.data?.items[0];

  return (
    <section className="relative mb-12 grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
      <div className="min-w-0 animate-fade-up">
        <span className="chip mb-5 bg-flame-500/10 text-flame-300 ring-1 ring-inset ring-flame-500/25">
          <LiveDot /> {liveCount ?? "…"} auctions live right now
        </span>
        <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Bid live.
          <br />
          <span className="bg-gradient-to-r from-flame-400 via-flame-500 to-amber-400 bg-clip-text text-transparent">
            Ride home.
          </span>
        </h1>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-zinc-400 sm:text-lg">
          Pre-owned motorcycles from riders across India, auctioned in real time. Every bid appears instantly for
          everyone — and last-second snipes extend the clock, so the best offer always wins.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#browse" className="btn-primary px-5 py-3">
            Browse live auctions <ArrowRight className="h-4 w-4" />
          </a>
          {!user && (
            <Link to="/register" className="btn-ghost px-5 py-3">
              Create free account
            </Link>
          )}
        </div>
        <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-sm">
          {[
            { icon: Zap, title: "Real-time", text: "Bids pushed live" },
            { icon: Timer, title: "Anti-snipe", text: "Late bids extend" },
            { icon: ShieldCheck, title: "Reserve", text: "Sellers protected" },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <dt className="flex items-center gap-1.5 font-semibold text-zinc-200">
                <Icon className="h-4 w-4 text-flame-400" aria-hidden="true" /> {title}
              </dt>
              <dd className="mt-0.5 text-zinc-500">{text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="relative min-w-0 animate-fade-up [animation-delay:120ms]">
        <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-flame-500/10 blur-3xl" />
        {featured ? (
          <Link
            to={`/auctions/${featured.id}`}
            className="card group block overflow-hidden transition hover:border-flame-500/30 hover:shadow-glow"
          >
            <div className="relative">
              <BikeArt motorcycle={featured.motorcycle} size="lg" className="aspect-[16/10]" />
              <span className="chip absolute left-4 top-4 bg-ink-950/70 text-zinc-200 ring-1 ring-inset ring-white/10 backdrop-blur">
                <LiveDot /> Ending soonest
              </span>
            </div>
            <div className="flex items-end justify-between gap-4 p-5">
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold">{featured.title}</h2>
                <p className="text-sm text-zinc-400">{featured.motorcycle.location}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-2xl font-bold text-white">
                  <LivePrice amount={featured.current_price} />
                </div>
                <Countdown auction={featured} className="text-sm" />
              </div>
            </div>
          </Link>
        ) : spotlight.isLoading ? (
          <Skeleton className="aspect-[16/12] w-full" />
        ) : (
          <div className="card grid aspect-[16/11] place-items-center text-zinc-500">
            <Bike className="h-12 w-12" />
          </div>
        )}
      </div>
    </section>
  );
}

export function AuctionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "live") as Tab;
  const tabDef = TABS.find((t) => t.id === tab)!;
  const sort = tabDef.sorts.some((s) => s.id === params.get("sort")) ? params.get("sort")! : tabDef.sorts[0].id;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim());
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => setLimit(PAGE), [tab, sort, q]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    // Mirror the debounced search into the URL so results are shareable.
    if ((params.get("q") ?? "") !== q) update({ q: q || null });
  }, [q]);

  const counts = { live: useCount("live").data, scheduled: useCount("scheduled").data, ended: useCount("ended").data };
  const list = useQuery({
    queryKey: ["auctions", "list", tab, sort, q, limit],
    queryFn: () => api.auctions({ status: [tab], sort, q: q || undefined, limit }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Hero liveCount={counts.live} />

      <section id="browse" className="scroll-mt-24">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div role="tablist" aria-label="Auction status" className="flex gap-1 rounded-2xl border border-white/[0.06] bg-ink-900/70 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => update({ tab: t.id === "live" ? null : t.id, sort: null })}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition lg:flex-none",
                  tab === t.id ? "bg-white/[0.08] text-white shadow-card" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {t.id === "live" && <LiveDot />}
                {t.label}
                {counts[t.id] !== undefined && (
                  <span
                    className={clsx(
                      "rounded-md px-1.5 py-0.5 text-[11px] tabular",
                      tab === t.id ? "bg-flame-500/20 text-flame-300" : "bg-white/[0.05] text-zinc-500",
                    )}
                  >
                    {counts[t.id]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <label className="relative flex-1 lg:w-72 lg:flex-none">
              <span className="sr-only">Search auctions</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search make, model or city"
                className="input pl-9"
              />
            </label>
            <label>
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="input w-auto pr-8">
                {tabDef.sorts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {list.isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-80" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            icon={<Bike className="h-8 w-8" />}
            title="Couldn't load auctions"
            action={
              <button className="btn-ghost" onClick={() => list.refetch()}>
                Try again
              </button>
            }
          >
            The server may be waking up — free hosting sleeps when idle. Give it a few seconds.
          </EmptyState>
        ) : list.data && list.data.items.length > 0 ? (
          <>
            <div
              className={clsx(
                "grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
                list.isPlaceholderData && "opacity-60",
              )}
            >
              {list.data.items.map((a, i) => (
                <AuctionCard key={a.id} auction={a} index={i} />
              ))}
            </div>
            {list.data.total > list.data.items.length && (
              <div className="mt-10 flex justify-center">
                <button className="btn-ghost px-6" onClick={() => setLimit((l) => l + PAGE)} disabled={list.isFetching}>
                  Show more ({list.data.total - list.data.items.length} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title={q ? `No matches for “${q}”` : tab === "live" ? "No live auctions right now" : "Nothing here yet"}
          >
            {q ? "Try a different make, model or city." : "Check the upcoming tab — new bikes are listed all the time."}
          </EmptyState>
        )}
      </section>
    </>
  );
}
