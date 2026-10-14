from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.db import utcnow
from app.models import Auction, AuctionStatus, Bid, Motorcycle, User
from app.schemas import AdminStats, AuctionCreate, AuctionUpdate, _check_prices, _check_window

SortKey = Literal["ending_soon", "newest", "recently_ended", "price_asc", "price_desc", "most_bids"]

_SORTS = {
    "ending_soon": (Auction.ends_at.asc(), Auction.id.asc()),
    "newest": (Auction.created_at.desc(), Auction.id.desc()),
    "recently_ended": (Auction.ends_at.desc(), Auction.id.desc()),
    "price_asc": (Auction.current_price.asc(), Auction.id.asc()),
    "price_desc": (Auction.current_price.desc(), Auction.id.desc()),
    "most_bids": (Auction.bid_count.desc(), Auction.id.desc()),
}


def with_relations(stmt: Select) -> Select:
    return stmt.options(
        joinedload(Auction.motorcycle),
        joinedload(Auction.leading_bidder),
        joinedload(Auction.winner),
    )


async def get_auction(session: AsyncSession, auction_id: int, *, lock: bool = False) -> Auction:
    stmt = with_relations(select(Auction).where(Auction.id == auction_id))
    if lock:
        # Lock only the auction row; the joined user/motorcycle rows are just read.
        # populate_existing: if this session already holds the auction, overwrite it
        # with the freshly locked row instead of trusting possibly stale values.
        stmt = stmt.with_for_update(of=Auction).execution_options(populate_existing=True)
    auction = (await session.execute(stmt)).unique().scalar_one_or_none()
    if auction is None:
        raise NotFoundError("Auction not found", code="AUCTION_NOT_FOUND")
    return auction


async def get_many(session: AsyncSession, ids: Sequence[int]) -> list[Auction]:
    if not ids:
        return []
    stmt = with_relations(select(Auction).where(Auction.id.in_(ids)))
    return list((await session.execute(stmt)).unique().scalars())


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_auctions(
    session: AsyncSession,
    *,
    statuses: list[AuctionStatus] | None,
    q: str | None,
    sort: SortKey,
    limit: int,
    offset: int,
) -> tuple[list[Auction], int]:
    filters = []
    if statuses:
        filters.append(Auction.status.in_(statuses))
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        filters.append(
            or_(
                Auction.title.ilike(pattern, escape="\\"),
                Motorcycle.make.ilike(pattern, escape="\\"),
                Motorcycle.model.ilike(pattern, escape="\\"),
                Motorcycle.location.ilike(pattern, escape="\\"),
            )
        )

    base = select(Auction).join(Motorcycle, Auction.motorcycle_id == Motorcycle.id).where(*filters)
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0

    stmt = with_relations(base).order_by(*_SORTS[sort]).limit(limit).offset(offset)
    items = list((await session.execute(stmt)).unique().scalars())
    return items, total


async def create_auction(session: AsyncSession, data: AuctionCreate, creator: User) -> Auction:
    now = utcnow()
    if data.ends_at <= now + timedelta(minutes=1):
        raise AppError("The auction must end at least 1 minute from now", code="INVALID_SCHEDULE")

    motorcycle = Motorcycle(**data.motorcycle.model_dump(mode="json"))
    auction = Auction(
        motorcycle=motorcycle,
        title=data.title,
        # Starting now (or in the past) means live immediately rather than waiting for the scheduler.
        status=AuctionStatus.LIVE if data.starts_at <= now else AuctionStatus.SCHEDULED,
        starting_price=data.starting_price,
        reserve_price=data.reserve_price,
        min_increment=data.min_increment,
        current_price=data.starting_price,
        bid_count=0,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        created_by_id=creator.id,
    )
    session.add(auction)
    await session.commit()
    return await get_auction(session, auction.id)


async def update_auction(session: AsyncSession, auction_id: int, data: AuctionUpdate) -> Auction:
    auction = await get_auction(session, auction_id, lock=True)
    if auction.status != AuctionStatus.SCHEDULED:
        raise ConflictError(
            "Only scheduled auctions can be edited", code="AUCTION_NOT_EDITABLE"
        )

    changes = data.model_dump(exclude_unset=True, exclude={"motorcycle"})
    starts_at = changes.get("starts_at", auction.starts_at)
    ends_at = changes.get("ends_at", auction.ends_at)
    starting = changes.get("starting_price", auction.starting_price)
    reserve = changes["reserve_price"] if "reserve_price" in changes else auction.reserve_price
    try:
        _check_window(starts_at, ends_at)
        _check_prices(starting, reserve)
    except ValueError as exc:
        raise AppError(str(exc), code="VALIDATION_ERROR") from exc
    if starts_at <= utcnow():
        raise AppError("starts_at must be in the future", code="INVALID_SCHEDULE")

    for field, value in changes.items():
        setattr(auction, field, value)
    auction.current_price = auction.starting_price  # no bids yet while scheduled
    if data.motorcycle is not None:
        for field, value in data.motorcycle.model_dump(mode="json").items():
            setattr(auction.motorcycle, field, value)

    await session.commit()
    return await get_auction(session, auction_id)


async def cancel_auction(session: AsyncSession, auction_id: int) -> Auction:
    auction = await get_auction(session, auction_id, lock=True)
    if auction.status not in (AuctionStatus.SCHEDULED, AuctionStatus.LIVE):
        raise ConflictError(
            f"A {auction.status.value} auction cannot be cancelled", code="AUCTION_NOT_CANCELLABLE"
        )
    auction.status = AuctionStatus.CANCELLED
    auction.ended_at = utcnow()
    auction.winner_id = None
    await session.commit()
    return await get_auction(session, auction_id)


async def list_bids(
    session: AsyncSession, auction_id: int, *, limit: int, offset: int
) -> tuple[list[Bid], int]:
    await get_auction(session, auction_id)  # 404 for unknown auctions
    total = await session.scalar(select(func.count()).where(Bid.auction_id == auction_id)) or 0
    stmt = (
        select(Bid)
        .options(joinedload(Bid.bidder))
        .where(Bid.auction_id == auction_id)
        .order_by(Bid.amount.desc())
        .limit(limit)
        .offset(offset)
    )
    return list((await session.execute(stmt)).scalars()), total


async def auctions_for_bidder(session: AsyncSession, user_id: int) -> list[tuple[Auction, int]]:
    mine = (
        select(Bid.auction_id, func.max(Bid.amount).label("my_max"))
        .where(Bid.bidder_id == user_id)
        .group_by(Bid.auction_id)
        .subquery()
    )
    stmt = with_relations(
        select(Auction, mine.c.my_max)
        .join(mine, mine.c.auction_id == Auction.id)
        .order_by(Auction.ends_at.desc())
    )
    rows = (await session.execute(stmt)).unique().all()
    return [(row[0], row[1]) for row in rows]


async def admin_stats(session: AsyncSession, now: datetime | None = None) -> AdminStats:
    now = now or utcnow()
    by_status = dict(
        (await session.execute(select(Auction.status, func.count()).group_by(Auction.status))).all()
    )
    return AdminStats(
        users=await session.scalar(select(func.count()).select_from(User)) or 0,
        auctions_by_status={s: by_status.get(s, 0) for s in AuctionStatus},
        total_bids=await session.scalar(select(func.count()).select_from(Bid)) or 0,
        bids_last_hour=await session.scalar(
            select(func.count()).where(Bid.created_at >= now - timedelta(hours=1))
        )
        or 0,
        gross_sales=await session.scalar(
            select(func.coalesce(func.sum(Auction.current_price), 0)).where(
                Auction.status == AuctionStatus.ENDED, Auction.winner_id.is_not(None)
            )
        )
        or 0,
    )
