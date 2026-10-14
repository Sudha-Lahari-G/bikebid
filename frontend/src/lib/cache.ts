import type { QueryClient } from "@tanstack/react-query";
import type { Auction, MyAuction, Page } from "./types";

/** Merge a pushed auction snapshot into every cached view that shows it. */
export function applyAuctionUpdate(qc: QueryClient, auction: Auction, myUserId: number | null) {
  qc.setQueryData<Auction>(["auction", auction.id], (old) => (old ? { ...old, ...auction } : old));

  const patchPage = <T extends Auction>(page: Page<T> | undefined) =>
    page && {
      ...page,
      items: page.items.map((a) => (a.id === auction.id ? { ...a, ...auction } : a)),
    };
  qc.setQueriesData<Page<Auction>>({ queryKey: ["auctions"] }, patchPage);
  qc.setQueriesData<Page<Auction>>({ queryKey: ["admin", "auctions"] }, patchPage);

  qc.setQueryData<MyAuction[]>(["me", "auctions"], (rows) =>
    rows?.map((row) =>
      row.auction.id === auction.id
        ? {
            ...row,
            auction,
            is_leading: auction.leading_bidder?.id === myUserId,
            is_winner: auction.winner?.id === myUserId,
          }
        : row,
    ),
  );
}
