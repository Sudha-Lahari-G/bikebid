"""Bid placement — the one place where correctness under concurrency matters most.

Every bid runs in a single transaction that takes a row lock on the auction
(`SELECT ... FOR UPDATE`). Concurrent bids on the same auction therefore
queue up and each one is validated against the price the previous one left
behind; bids on *different* auctions never block each other.

The lifecycle scheduler closes auctions with a guarded
`UPDATE ... WHERE status='live' AND ends_at <= now`. That UPDATE also waits for
the row lock, and PostgreSQL re-checks the WHERE clause against the committed
row afterwards — so if a last-second bid extended `ends_at` (anti-sniping),
the auction correctly stays open.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, ForbiddenError
from app.db import utcnow
from app.models import Auction, AuctionStatus, Bid, User, UserRole
from app.services.auctions import get_auction


@dataclass(frozen=True)
class BidResult:
    bid: Bid
    auction: Auction
    previous_leader_id: int | None
    extended: bool


async def place_bid(
    session: AsyncSession,
    *,
    auction_id: int,
    bidder: User,
    amount: int,
    settings: Settings,
    now: datetime | None = None,
) -> BidResult:
    if bidder.role == UserRole.ADMIN:
        raise ForbiddenError("Administrators cannot bid", code="ADMIN_CANNOT_BID")

    auction = await get_auction(session, auction_id, lock=True)
    # Read the clock *after* acquiring the lock: time spent waiting counts.
    now = now or utcnow()

    if auction.status != AuctionStatus.LIVE or not (auction.starts_at <= now < auction.ends_at):
        raise ConflictError("This auction is not accepting bids", code="AUCTION_NOT_LIVE")
    if auction.leading_bidder_id == bidder.id:
        raise ConflictError("You already have the highest bid", code="ALREADY_LEADING")
    if amount < auction.next_min_bid:
        raise ConflictError(
            f"Bid must be at least ₹{auction.next_min_bid:,}",
            code="BID_TOO_LOW",
            details={"min_bid": auction.next_min_bid, "current_price": auction.current_price},
        )

    previous_leader_id = auction.leading_bidder_id
    bid = Bid(auction_id=auction.id, bidder=bidder, amount=amount, created_at=now)
    session.add(bid)

    auction.current_price = amount
    auction.bid_count += 1
    auction.leading_bidder = bidder

    extended = False
    window = timedelta(seconds=settings.anti_snipe_window_seconds)
    if auction.ends_at - now < window:
        new_end = now + timedelta(seconds=settings.anti_snipe_extension_seconds)
        if new_end > auction.ends_at:
            auction.ends_at = new_end
            auction.extension_count += 1
            extended = True

    await session.commit()
    return BidResult(bid=bid, auction=auction, previous_leader_id=previous_leader_id, extended=extended)
