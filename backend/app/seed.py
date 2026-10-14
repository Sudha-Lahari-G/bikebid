"""Populate the database with realistic demo data.

    python -m app.seed               # only if there are no auctions yet
    python -m app.seed --reset       # wipe auctions/bids/motorcycles first
    python -m app.seed --ended 80 --live 10 --upcoming 12

Ended and live auctions get a plausible bid history from the demo bidders.
"""

import argparse
import asyncio
import random
from datetime import datetime, timedelta

from sqlalchemy import func, select, text

from app.catalog import DEMO_BIDDERS, DEMO_EMAIL_DOMAIN, random_listing
from app.core.config import get_settings
from app.db import SessionFactory, engine, utcnow
from app.models import Auction, AuctionStatus, Bid, Motorcycle, User, UserRole
from app.services import users as user_service

DEFAULT_PASSWORD = "BikeBid@123"


def _bid_history(
    rng: random.Random,
    auction: Auction,
    bidders: list[User],
    *,
    until: datetime,
    max_price: float,
) -> list[Bid]:
    bids: list[Bid] = []
    price = auction.starting_price
    leader: User | None = None
    count = rng.randint(0, 14) if rng.random() > 0.1 else 0
    window = (until - auction.starts_at).total_seconds()
    times = sorted(rng.uniform(0, window) for _ in range(count))
    for offset in times:
        amount = price if not bids else price + auction.min_increment * rng.choice((1, 1, 1, 2, 3))
        if amount > max_price and bids:
            break
        bidder = rng.choice([b for b in bidders if b is not leader])
        bids.append(
            Bid(
                auction=auction,
                bidder=bidder,
                amount=amount,
                created_at=auction.starts_at + timedelta(seconds=offset),
            )
        )
        price, leader = amount, bidder
    if bids:
        auction.current_price = price
        auction.bid_count = len(bids)
        auction.leading_bidder = leader
    return bids


async def seed(*, ended: int, live: int, upcoming: int, reset: bool, seed_value: int) -> None:
    settings = get_settings()
    rng = random.Random(seed_value)
    now = utcnow()

    async with SessionFactory() as session:
        if reset:
            await session.execute(text("TRUNCATE bids, auctions, motorcycles RESTART IDENTITY CASCADE"))
            await session.commit()
        elif await session.scalar(select(func.count()).select_from(Auction)):
            print("Auctions already exist — skipping (use --reset to start over).")
            return

        admin = await user_service.ensure_user(
            session,
            email=settings.admin_email or "admin@bikebid.dev",
            full_name="Platform Admin",
            password=settings.admin_password or DEFAULT_PASSWORD,
            role=UserRole.ADMIN,
        )
        bidders = [
            await user_service.ensure_user(
                session,
                email=f"{handle}@{DEMO_EMAIL_DOMAIN}",
                full_name=name,
                password=DEFAULT_PASSWORD,
                role=UserRole.USER,
            )
            for name, handle in DEMO_BIDDERS
        ]
        await user_service.ensure_user(
            session,
            email=settings.demo_user_email,
            full_name="Demo Rider",
            password=settings.demo_user_password or DEFAULT_PASSWORD,
            role=UserRole.USER,
        )

        plans: list[tuple[AuctionStatus, datetime, timedelta]] = []
        for _ in range(ended):
            duration = timedelta(hours=rng.randint(2, 72))
            start = now - timedelta(days=rng.uniform(1, 45)) - duration
            plans.append((AuctionStatus.ENDED, start, duration))
        for _ in range(live):
            duration = timedelta(minutes=rng.randint(20, 240))
            start = now - duration * rng.uniform(0.2, 0.8)
            plans.append((AuctionStatus.LIVE, start, duration))
        for _ in range(upcoming):
            start = now + timedelta(minutes=rng.randint(10, 60 * 48))
            plans.append((AuctionStatus.SCHEDULED, start, timedelta(hours=rng.randint(1, 48))))

        total_bids = 0
        for status, starts_at, duration in plans:
            listing = random_listing(rng, starts_at=starts_at, duration=duration, current_year=now.year)
            auction = Auction(
                motorcycle=Motorcycle(**listing.motorcycle.model_dump(mode="json")),
                title=listing.title,
                status=status,
                starting_price=listing.starting_price,
                reserve_price=listing.reserve_price,
                min_increment=listing.min_increment,
                current_price=listing.starting_price,
                bid_count=0,
                starts_at=listing.starts_at,
                ends_at=listing.ends_at,
                created_by_id=admin.id,
            )
            session.add(auction)
            if status != AuctionStatus.SCHEDULED:
                ceiling = (listing.reserve_price or listing.starting_price * 1.4) * rng.uniform(0.9, 1.2)
                until = min(now, listing.ends_at)
                bids = _bid_history(rng, auction, bidders, until=until, max_price=ceiling)
                session.add_all(bids)
                total_bids += len(bids)
            if status == AuctionStatus.ENDED:
                auction.ended_at = listing.ends_at
                if auction.reserve_met:
                    auction.winner = auction.leading_bidder

        await session.commit()
        print(
            f"Seeded {len(plans)} auctions ({ended} ended, {live} live, {upcoming} upcoming) "
            f"with {total_bids} bids and {len(bidders) + 2} users."
        )
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ended", type=int, default=60)
    parser.add_argument("--live", type=int, default=8)
    parser.add_argument("--upcoming", type=int, default=10)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    asyncio.run(
        seed(ended=args.ended, live=args.live, upcoming=args.upcoming, reset=args.reset, seed_value=args.seed)
    )


if __name__ == "__main__":
    main()
