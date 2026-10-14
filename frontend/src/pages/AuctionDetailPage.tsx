import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Cog,
  Crown,
  Gauge,
  Gavel,
  History,
  MapPin,
  Palette,
  PartyPopper,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BikeArt } from "../components/BikeArt";
import { Countdown, EmptyState, LiveDot, LivePrice, Skeleton, Spinner, StatusBadge } from "../components/ui";
import { ApiError, api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyAuctionUpdate } from "../lib/cache";
import { useNow } from "../lib/clock";
import { formatDateTime, formatINR, formatKm, quickBids, timeAgo } from "../lib/format";
import { useLiveChannel } from "../lib/live";
import type { Auction, Bid, LiveEvent, Page } from "../lib/types";

const CONDITION_LABEL = { excellent: "Excellent", good: "Good", fair: "Fair", project: "Project bike" };

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-medium text-zinc-100">{value}</div>
    </div>
  );
}

function ReserveNote({ auction }: { auction: Auction }) {
  if (!auction.has_reserve)
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <ShieldCheck className="h-4 w-4" /> No reserve — highest bid wins
      </span>
    );
  return auction.reserve_met ? (
    <span className="inline-flex items-center gap-1.5 text-emerald-300">
      <CheckCircle2 className="h-4 w-4" /> Reserve met
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-amber-300">
      <ShieldAlert className="h-4 w-4" /> Reserve not yet met
    </span>
  );
}

function BidPanel({ auction }: { auction: Auction }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const location = useLocation();
  const [amount, setAmount] = useState(String(auction.next_min_bid));
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Follow the minimum as others bid, unless the user typed their own amount.
  useEffect(() => {
    if (!dirty) setAmount(String(auction.next_min_bid));
    setConfirming(false);
  }, [auction.next_min_bid, dirty]);

  const mutation = useMutation({
    mutationFn: (value: number) => api.placeBid(auction.id, value),
    onSuccess: (result) => {
      applyAuctionUpdate(qc, result.auction, user?.id ?? null);
      mergeBid(qc, auction.id, result.bid);
      setDirty(false);
      toast.success(`You're the highest bidder at ${formatINR(result.bid.amount)}`, {
        description: result.extended ? "Late bid — the clock was extended by 2 minutes." : undefined,
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "BID_TOO_LOW") {
        qc.invalidateQueries({ queryKey: ["auction", auction.id] });
        setDirty(false);
      }
      toast.error(errorMessage(error));
    },
  });

  const value = Number(amount.replace(/[^\d]/g, ""));
  const tooLow = value < auction.next_min_bid;
  const bigJump = value >= auction.next_min_bid + auction.min_increment * 10;
  const leading = !!user && auction.leading_bidder?.id === user.id;

  const submit = () => {
    if (!value || tooLow || mutation.isPending) return;
    if (bigJump && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    mutation.mutate(value);
  };

  if (auction.status === "scheduled") {
    return (
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-200">
        Bidding opens {formatDateTime(auction.starts_at)}. Starting bid {formatINR(auction.starting_price)}.
      </div>
    );
  }
  if (auction.status !== "live") return null;
  if (!user) {
    return (
      <Link to="/login" state={{ from: location.pathname }} className="btn-primary w-full py-3">
        <Gavel className="h-4 w-4" /> Sign in to bid
      </Link>
    );
  }
  if (user.role === "admin") {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
        You're signed in as an administrator. Admin accounts can't bid, which keeps the auction fair.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {leading && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
          <Crown className="h-4 w-4" /> You're the highest bidder
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {quickBids(auction.next_min_bid, auction.min_increment).map((q) => (
          <button
            key={q}
            type="button"
            disabled={leading}
            onClick={() => {
              setAmount(String(q));
              setDirty(q !== auction.next_min_bid);
              setConfirming(false);
            }}
            className={clsx(
              "rounded-xl border px-2 py-2 text-sm font-semibold tabular transition disabled:opacity-40",
              value === q
                ? "border-flame-500/60 bg-flame-500/10 text-flame-200"
                : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20",
            )}
          >
            {formatINR(q)}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <label htmlFor="bid-amount" className="sr-only">
          Your bid in rupees
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-lg text-zinc-500">₹</span>
          <input
            id="bid-amount"
            inputMode="numeric"
            autoComplete="off"
            disabled={leading}
            value={value ? new Intl.NumberFormat("en-IN").format(value) : ""}
            onChange={(e) => {
              setAmount(e.target.value);
              setDirty(true);
              setConfirming(false);
            }}
            className={clsx("input py-3.5 pl-9 font-display text-lg tabular", tooLow && value > 0 && "border-amber-500/50")}
            aria-describedby="bid-help"
          />
        </div>
        <p id="bid-help" className={clsx("text-xs", tooLow && value > 0 ? "text-amber-300" : "text-zinc-500")}>
          {tooLow && value > 0
            ? `Minimum bid is ${formatINR(auction.next_min_bid)}`
            : `Minimum ${formatINR(auction.next_min_bid)} · increments of ${formatINR(auction.min_increment)}`}
        </p>
        <button
          type="submit"
          disabled={leading || tooLow || mutation.isPending}
          className={clsx("btn-primary w-full py-3.5 text-base", confirming && "bg-amber-500 hover:bg-amber-400")}
        >
          {mutation.isPending ? (
            <>
              <Spinner /> Placing bid…
            </>
          ) : confirming ? (
            <>Confirm {formatINR(value)} — that's {formatINR(value - auction.next_min_bid)} above minimum</>
          ) : (
            <>
              <Gavel className="h-4 w-4" /> Place bid {value ? formatINR(value) : ""}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

function mergeBid(qc: ReturnType<typeof useQueryClient>, auctionId: number, bid: Bid) {
  qc.setQueryData<Page<Bid>>(["auction", auctionId, "bids"], (page) => {
    if (!page || page.items.some((b) => b.id === bid.id)) return page;
    return { ...page, total: page.total + 1, items: [bid, ...page.items].sort((a, b) => b.amount - a.amount) };
  });
}

function ResultBanner({ auction }: { auction: Auction }) {
  const { user } = useAuth();
  if (auction.status === "cancelled")
    return (
      <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-5 text-sm text-red-200">
        This auction was withdrawn and no sale took place.
      </div>
    );
  if (auction.status !== "ended") return null;
  if (auction.winner && auction.winner.id === user?.id)
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 p-5">
        <PartyPopper className="absolute -right-2 -top-2 h-20 w-20 text-emerald-400/20" />
        <div className="font-display text-xl font-bold text-emerald-200">You won this bike!</div>
        <p className="mt-1 text-sm text-emerald-100/80">
          Winning bid {formatINR(auction.current_price)}. The seller will contact you to arrange inspection and handover.
        </p>
      </div>
    );
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="font-display text-lg font-semibold">
        {auction.winner
          ? `Sold to ${auction.winner.display_name}`
          : auction.bid_count
            ? "Not sold — reserve not met"
            : "Not sold — no bids"}
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        {auction.bid_count
          ? `Final bid ${formatINR(auction.current_price)} after ${auction.bid_count} bids.`
          : `Opened at ${formatINR(auction.starting_price)}.`}
      </p>
    </div>
  );
}

function BidHistory({ auctionId, highlightId }: { auctionId: number; highlightId: number | null }) {
  const { user } = useAuth();
  const now = useNow();
  const bids = useQuery({ queryKey: ["auction", auctionId, "bids"], queryFn: () => api.bids(auctionId) });

  return (
    <section className="card p-5" aria-labelledby="history-title">
      <h2 id="history-title" className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
        <History className="h-5 w-5 text-zinc-400" /> Bid history
        {bids.data && <span className="text-sm font-normal text-zinc-500">({bids.data.total})</span>}
      </h2>
      {bids.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !bids.data?.items.length ? (
        <p className="py-6 text-center text-sm text-zinc-500">No bids yet — be the first.</p>
      ) : (
        <ol className="-mr-2 max-h-[26rem] space-y-1.5 overflow-y-auto pr-2" aria-live="polite">
          {bids.data.items.map((bid, i) => {
            const mine = bid.bidder.id === user?.id;
            return (
              <li
                key={bid.id}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                  i === 0 ? "bg-flame-500/10 ring-1 ring-inset ring-flame-500/25" : "bg-white/[0.02]",
                  bid.id === highlightId && "animate-slide-in",
                )}
              >
                <span
                  className={clsx(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold",
                    i === 0 ? "bg-flame-500 text-white" : "bg-white/[0.06] text-zinc-400",
                  )}
                >
                  {i === 0 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {bid.bidder.display_name}
                  {mine && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">You</span>}
                </span>
                <span className="text-xs text-zinc-500">{timeAgo(bid.created_at, now)}</span>
                <span className={clsx("w-28 text-right font-semibold tabular", i === 0 ? "text-white" : "text-zinc-300")}>
                  {formatINR(bid.amount)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function AuctionDetailPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const auction = useQuery({ queryKey: ["auction", id], queryFn: () => api.auction(id), enabled: Number.isFinite(id) });

  const onEvent = useCallback(
    (event: LiveEvent) => {
      if (event.type === "bid.placed") {
        applyAuctionUpdate(qc, event.auction, user?.id ?? null);
        mergeBid(qc, id, event.bid);
        setHighlightId(event.bid.id);
        const outbid = user && event.previous_leader_id === user.id && event.bid.bidder.id !== user.id;
        if (outbid) {
          toast.warning("You've been outbid!", {
            description: `${event.bid.bidder.display_name} bid ${formatINR(event.bid.amount)}. Minimum is now ${formatINR(event.auction.next_min_bid)}.`,
            duration: 8000,
          });
        } else if (event.extended) {
          toast("Clock extended", { description: "A last-minute bid added time — anti-sniping protection.", icon: <Timer className="h-4 w-4" /> });
        }
      } else if (event.type === "auction.updated") {
        applyAuctionUpdate(qc, event.auction, user?.id ?? null);
        if (event.reason === "ended" && event.auction.winner?.id === user?.id && user) {
          toast.success("You won the auction! 🏍️", { duration: 10000 });
        } else if (event.reason === "started") {
          toast("Bidding is open", { icon: <Sparkles className="h-4 w-4" /> });
        }
      }
    },
    [qc, id, user],
  );
  const refetch = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["auction", id] });
  }, [qc, id]);
  const liveState = useLiveChannel(Number.isFinite(id) ? `/ws/auctions/${id}` : null, onEvent, refetch);

  useEffect(() => {
    if (auction.data) document.title = `${auction.data.title} · BikeBid`;
    return () => {
      document.title = "BikeBid — Live Motorcycle Auctions";
    };
  }, [auction.data]);

  if (auction.isLoading) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="aspect-[16/10]" />
        <Skeleton className="h-[28rem]" />
      </div>
    );
  }
  if (auction.isError || !auction.data) {
    return (
      <EmptyState
        icon={<Gavel className="h-8 w-8" />}
        title="Auction not found"
        action={
          <Link to="/" className="btn-ghost">
            Back to auctions
          </Link>
        }
      >
        It may have been removed, or the link is wrong.
      </EmptyState>
    );
  }

  const a = auction.data;
  const m = a.motorcycle;
  const finished = a.status === "ended" || a.status === "cancelled";

  return (
    <div className="animate-fade-up">
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All auctions
      </Link>

      {/* Mobile order: photo + title, then price & bidding, then specs. Desktop: two columns. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.4fr_1fr] lg:grid-rows-[auto_1fr] lg:gap-x-8">
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <div className="card overflow-hidden">
            <BikeArt motorcycle={m} size="lg" className="aspect-[16/10]" />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              {a.extension_count > 0 && (
                <span className="chip bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/25">
                  <Timer className="h-3 w-3" /> Extended ×{a.extension_count}
                </span>
              )}
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{a.title}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-zinc-400">
              <MapPin className="h-4 w-4" /> {m.location}
            </p>
          </div>
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Spec icon={<CalendarClock className="h-3.5 w-3.5" />} label="Year" value={m.year} />
            <Spec icon={<Gauge className="h-3.5 w-3.5" />} label="Mileage" value={formatKm(m.mileage_km)} />
            <Spec icon={<Cog className="h-3.5 w-3.5" />} label="Engine" value={`${m.engine_cc} cc`} />
            <Spec icon={<Sparkles className="h-3.5 w-3.5" />} label="Condition" value={CONDITION_LABEL[m.condition]} />
            <Spec icon={<Palette className="h-3.5 w-3.5" />} label="Colour" value={m.color ?? "—"} />
            <Spec icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={m.location} />
          </div>

          {m.description && (
            <section className="card p-5">
              <h2 className="mb-2 font-display text-lg font-semibold">About this bike</h2>
              <p className="whitespace-pre-line leading-relaxed text-zinc-300">{m.description}</p>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className={clsx("card p-6", a.status === "live" && "border-flame-500/20")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-zinc-400">
                  {finished ? (a.winner ? "Sold for" : "Final bid") : a.bid_count ? "Current bid" : "Starting bid"}
                </div>
                <div className="mt-1 font-display text-4xl font-bold text-white">
                  <LivePrice amount={a.current_price} />
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  {a.bid_count} {a.bid_count === 1 ? "bid" : "bids"}
                  {a.leading_bidder && !finished && <> · leading: {a.leading_bidder.display_name}</>}
                </div>
              </div>
              {a.status === "live" && (
                <span
                  className={clsx(
                    "chip shrink-0",
                    liveState === "live" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300",
                  )}
                  title={liveState === "live" ? "Updates arrive instantly" : "Reconnecting…"}
                >
                  {liveState === "live" ? <LiveDot className="[&>span]:bg-emerald-400" /> : <Spinner className="h-3 w-3" />}
                  {liveState === "live" ? "Live" : "Syncing"}
                </span>
              )}
            </div>

            {!finished && (
              <div className="mt-5 rounded-xl border border-white/[0.06] bg-ink-850 px-4 py-3">
                <Countdown auction={a} big />
              </div>
            )}

            <div className="mt-4 text-sm">
              <ReserveNote auction={a} />
            </div>

            <div className="mt-5">{finished ? <ResultBanner auction={a} /> : <BidPanel auction={a} />}</div>

            <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-5 text-sm">
              <div>
                <dt className="text-zinc-500">Starting bid</dt>
                <dd className="font-medium tabular">{formatINR(a.starting_price)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Bid increment</dt>
                <dd className="font-medium tabular">{formatINR(a.min_increment)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{a.status === "scheduled" ? "Starts" : "Started"}</dt>
                <dd className="font-medium">{formatDateTime(a.starts_at)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">{finished ? "Ended" : "Ends"}</dt>
                <dd className="font-medium">{formatDateTime(a.ended_at ?? a.ends_at)}</dd>
              </div>
            </dl>
          </div>

          <BidHistory auctionId={a.id} highlightId={highlightId} />
        </aside>
      </div>
    </div>
  );
}
