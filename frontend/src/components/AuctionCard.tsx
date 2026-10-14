import clsx from "clsx";
import { Gauge, MapPin, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { formatINR, formatKm } from "../lib/format";
import type { Auction } from "../lib/types";
import { BikeArt } from "./BikeArt";
import { Countdown, LivePrice, StatusBadge } from "./ui";

export function AuctionCard({ auction, index = 0 }: { auction: Auction; index?: number }) {
  const m = auction.motorcycle;
  const finished = auction.status === "ended" || auction.status === "cancelled";
  const priceLabel =
    auction.status === "scheduled"
      ? "Starting bid"
      : finished
        ? auction.winner
          ? "Sold for"
          : "Final bid"
        : auction.bid_count
          ? "Current bid"
          : "Starting bid";

  return (
    <Link
      to={`/auctions/${auction.id}`}
      className="group card block animate-fade-up overflow-hidden transition duration-300 hover:-translate-y-1 hover:border-flame-500/30 hover:shadow-glow"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="relative">
        <BikeArt motorcycle={m} className="aspect-[16/10] transition duration-500 group-hover:scale-[1.03]" />
        <div className="absolute left-3 top-3">
          <StatusBadge status={auction.status} />
        </div>
        {auction.extension_count > 0 && auction.status === "live" && (
          <span className="chip absolute right-3 top-3 bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30">
            Extended
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="truncate font-display text-[17px] font-semibold tracking-tight text-white">{auction.title}</h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              {formatKm(m.mileage_km)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{m.location}</span>
            </span>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">{priceLabel}</div>
            <div
              className={clsx(
                "font-display text-xl font-semibold",
                finished && !auction.winner ? "text-zinc-400" : "text-white",
              )}
            >
              {auction.status === "live" ? <LivePrice amount={auction.current_price} /> : formatINR(auction.current_price)}
            </div>
          </div>
          <div className="text-right text-xs">
            {finished ? (
              auction.winner ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> {auction.winner.display_name}
                </span>
              ) : (
                <span className="text-zinc-500">{auction.status === "cancelled" ? "Withdrawn" : "Not sold"}</span>
              )
            ) : (
              <Countdown auction={auction} />
            )}
            <div className="mt-0.5 text-zinc-500">
              {auction.bid_count} {auction.bid_count === 1 ? "bid" : "bids"}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
