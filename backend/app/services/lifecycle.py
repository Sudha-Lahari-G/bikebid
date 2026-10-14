"""Auction lifecycle: SCHEDULED -> LIVE -> ENDED (or CANCELLED by an admin).

The scheduler runs inside every API process (free hosting tiers have no
separate worker dynos). Transitions are single guarded UPDATE statements
(`... WHERE status = 'scheduled' AND starts_at <= now`), which makes them
idempotent and safe when several instances tick at the same moment: each row
is transitioned by exactly one of them, and only that instance broadcasts it.
"""

import asyncio
import logging
import random
import secrets
import time
from datetime import timedelta

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog import DEMO_BIDDERS, DEMO_EMAIL_DOMAIN, random_listing
from app.core.config import Settings
from app.core.errors import AppError
from app.core.metrics import AUCTION_TRANSITIONS, SCHEDULER_ERRORS, SCHEDULER_TICK
from app.db import utcnow
from app.models import Auction, AuctionStatus, User, UserRole
from app.realtime import Broker, announce_bid, broadcast_auction
from app.schemas import AuctionOut
from app.services import auctions as auction_service
from app.services import users as user_service
from app.services.bidding import place_bid

logger = logging.getLogger(__name__)

# Arbitrary constant: only one instance at a time performs demo upkeep.
_DEMO_LOCK_ID = 7_310_442
_DEMO_MIN_LIVE = 4


async def advance_lifecycle(session: AsyncSession, now=None) -> tuple[list[int], list[int]]:
    """Apply due transitions. Returns (started_ids, ended_ids)."""
    now = now or utcnow()
    started = (
        await session.execute(
            update(Auction)
            .where(Auction.status == AuctionStatus.SCHEDULED, Auction.starts_at <= now)
            .values(status=AuctionStatus.LIVE)
            .returning(Auction.id)
            .execution_options(synchronize_session=False)
        )
    ).scalars().all()

    reserve_met = and_(
        Auction.bid_count > 0,
        or_(Auction.reserve_price.is_(None), Auction.current_price >= Auction.reserve_price),
    )
    ended = (
        await session.execute(
            update(Auction)
            .where(Auction.status == AuctionStatus.LIVE, Auction.ends_at <= now)
            .values(
                status=AuctionStatus.ENDED,
                ended_at=now,
                winner_id=case((reserve_met, Auction.leading_bidder_id), else_=None),
            )
            .returning(Auction.id)
            .execution_options(synchronize_session=False)
        )
    ).scalars().all()
    await session.commit()
    return list(started), list(ended)


class AuctionScheduler:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        broker: Broker,
        settings: Settings,
    ) -> None:
        self._session_factory = session_factory
        self._broker = broker
        self._settings = settings
        self._task: asyncio.Task[None] | None = None
        self._rng = random.Random()
        self.last_tick_ok_at: float | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="auction-scheduler")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        logger.info("scheduler_started", extra={"interval_s": self._settings.scheduler_interval_seconds})
        while True:
            started = time.perf_counter()
            try:
                await self.tick()
                self.last_tick_ok_at = time.time()
            except asyncio.CancelledError:
                raise
            except Exception:
                SCHEDULER_ERRORS.inc()
                logger.exception("scheduler_tick_failed")
            SCHEDULER_TICK.observe(time.perf_counter() - started)
            await asyncio.sleep(self._settings.scheduler_interval_seconds)

    async def tick(self) -> None:
        async with self._session_factory() as session:
            started, ended = await advance_lifecycle(session)
            changed = await auction_service.get_many(session, started + ended)

        for auction in changed:
            reason = "started" if auction.id in started else "ended"
            AUCTION_TRANSITIONS.labels(auction.status.value).inc()
            logger.info(
                "auction_" + reason,
                extra={
                    "auction_id": auction.id,
                    "winner_id": auction.winner_id,
                    "final_price": auction.current_price,
                    "bids": auction.bid_count,
                },
            )
            await broadcast_auction(self._broker, AuctionOut.from_model(auction), reason)

        if self._settings.demo_mode:
            await self._demo_upkeep()

    # ---------- demo mode ----------

    async def _demo_upkeep(self) -> None:
        """Keep the public demo lively: re-list bikes and let a few bots bid."""
        async with self._session_factory() as session:
            async with session.begin():
                locked = await session.scalar(select(func.pg_try_advisory_xact_lock(_DEMO_LOCK_ID)))
                if not locked:
                    return
                active = await session.scalar(
                    select(func.count()).where(
                        Auction.status.in_([AuctionStatus.SCHEDULED, AuctionStatus.LIVE])
                    )
                ) or 0
                live = list(
                    (
                        await session.execute(
                            select(Auction.id, Auction.ends_at, Auction.current_price,
                                   Auction.starting_price, Auction.reserve_price)
                            .where(Auction.status == AuctionStatus.LIVE)
                        )
                    ).all()
                )

        # Always keep a few auctions live (something to bid on) and a few upcoming.
        if len(live) < _DEMO_MIN_LIVE:
            await self._create_demo_auction(live_now=True)
        elif active < self._settings.demo_min_active_auctions:
            await self._create_demo_auction(live_now=False)

        now = utcnow()
        interval = self._settings.scheduler_interval_seconds
        for auction_id, ends_at, price, starting, reserve in live:
            remaining = (ends_at - now).total_seconds()
            mean_gap = 20 if remaining < 150 else 90  # bids cluster near the end, like real auctions
            ceiling = (reserve or starting * 1.5) * 1.12
            if price < ceiling and self._rng.random() < interval / mean_gap:
                await self._bot_bid(auction_id)

    async def _demo_users(self, session: AsyncSession) -> list[User]:
        return list(
            await session.scalars(
                select(User).where(User.email.like(f"%@{DEMO_EMAIL_DOMAIN}"), User.role == UserRole.USER)
            )
        )

    async def _create_demo_auction(self, *, live_now: bool) -> None:
        async with self._session_factory() as session:
            house = await user_service.ensure_user(
                session,
                email=f"house@{DEMO_EMAIL_DOMAIN}",
                full_name="BikeBid House",
                password=secrets.token_urlsafe(24),
                role=UserRole.ADMIN,
            )
            now = utcnow()
            starts_at = now if live_now else now + timedelta(minutes=self._rng.randint(1, 6))
            listing = random_listing(
                self._rng,
                starts_at=starts_at,
                duration=timedelta(minutes=self._rng.randint(8, 25)),
                current_year=now.year,
            )
            auction = await auction_service.create_auction(session, listing, house)
            logger.info("demo_auction_listed", extra={"auction_id": auction.id})
            await broadcast_auction(self._broker, AuctionOut.from_model(auction), "created")

    async def _bot_bid(self, auction_id: int) -> None:
        async with self._session_factory() as session:
            bots = await self._demo_users(session)
            auction = await auction_service.get_auction(session, auction_id)
            candidates = [b for b in bots if b.id != auction.leading_bidder_id]
            if not candidates:
                return
            bot = self._rng.choice(candidates)
            amount = auction.next_min_bid + auction.min_increment * self._rng.choice((0, 0, 0, 1, 2))
            try:
                result = await place_bid(
                    session, auction_id=auction_id, bidder=bot, amount=amount, settings=self._settings
                )
            except AppError:
                await session.rollback()  # a real user got there first — that's fine
                return
            await announce_bid(self._broker, result)


async def ensure_demo_bidders(session: AsyncSession, password: str | None) -> None:
    for full_name, handle in DEMO_BIDDERS:
        await user_service.ensure_user(
            session,
            email=f"{handle}@{DEMO_EMAIL_DOMAIN}",
            full_name=full_name,
            password=password or secrets.token_urlsafe(24),
            role=UserRole.USER,
        )
