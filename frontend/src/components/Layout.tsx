import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Gavel, LayoutDashboard, LogOut, Menu, Ticket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { applyAuctionUpdate } from "../lib/cache";
import { useLiveChannel, type LiveState } from "../lib/live";
import type { LiveEvent } from "../lib/types";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="BikeBid home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-flame-500 shadow-glow">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
          <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="20" r="4.5" />
            <circle cx="23" cy="20" r="4.5" />
            <path d="M9 20l5-8h6l3 8M14 12h-3M18 12l2-3h3" />
          </g>
        </svg>
      </span>
      <span className="font-display text-xl font-bold tracking-tight">
        Bike<span className="text-flame-500">Bid</span>
      </span>
    </Link>
  );
}

function ConnectionPill({ state }: { state: LiveState }) {
  return (
    <span
      className={clsx(
        "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex",
        state === "live" ? "text-emerald-300" : "text-amber-300",
      )}
      title={state === "live" ? "Receiving live updates" : "Reconnecting to live updates…"}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", state === "live" ? "bg-emerald-400" : "animate-pulse bg-amber-400")} />
      {state === "live" ? "Live" : "Connecting"}
    </span>
  );
}

/** One feed socket for the whole app keeps every list and card fresh. */
function useGlobalFeed(userId: number | null): LiveState {
  const qc = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshLists = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["auctions"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    }, 400);
  }, [qc]);

  const onEvent = useCallback(
    (event: LiveEvent) => {
      if (event.type !== "auction.updated") return;
      applyAuctionUpdate(qc, event.auction, userId);
      // Status changes move auctions between tabs; new listings need to appear.
      if (["created", "started", "ended", "cancelled", "edited"].includes(event.reason)) refreshLists();
    },
    [qc, userId, refreshLists],
  );

  return useLiveChannel("/ws/feed", onEvent, refreshLists);
}

export function Layout() {
  const { user, signOut } = useAuth();
  const state = useGlobalFeed(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const links = [
    { to: "/", label: "Auctions", icon: Gavel, show: true },
    { to: "/my-bids", label: "My bids", icon: Ticket, show: user?.role === "user" },
    { to: "/admin", label: "Admin", icon: LayoutDashboard, show: user?.role === "admin" },
  ].filter((l) => l.show);

  const navLink = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
      isActive ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:text-white",
    );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 btn-primary">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <ConnectionPill state={state} />
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} className={navLink}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:ml-2 md:flex">
            {user ? (
              <>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] py-1 pl-1 pr-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-flame-400 to-flame-700 text-xs font-bold">
                    {user.full_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="max-w-[10rem] truncate text-sm text-zinc-300">{user.full_name}</span>
                </div>
                <button onClick={signOut} className="btn-ghost px-3" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <Link to="/login" state={{ from: location.pathname }} className="btn-ghost">
                  Sign in
                </Link>
                <Link to="/register" className="btn-primary">
                  Start bidding
                </Link>
              </>
            )}
          </div>
          <button
            className="btn-ghost ml-auto px-2.5 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="animate-slide-in border-t border-white/[0.06] px-4 pb-4 pt-2 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {links.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === "/"} className={navLink}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex gap-2 border-t border-white/[0.06] pt-3">
              {user ? (
                <button onClick={signOut} className="btn-ghost w-full">
                  <LogOut className="h-4 w-4" /> Sign out ({user.full_name})
                </button>
              ) : (
                <>
                  <Link to="/login" className="btn-ghost flex-1">
                    Sign in
                  </Link>
                  <Link to="/register" className="btn-primary flex-1">
                    Start bidding
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} BikeBid · Live motorcycle auctions</span>
          <span className="flex gap-4">
            <a className="hover:text-zinc-300" href={`${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/docs`}>
              API docs
            </a>
            <span>Prices in INR · All times shown in your local time zone</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
