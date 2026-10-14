import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import BrokerDep, CurrentUser, SessionDep, SettingsDep, rate_limit
from app.core.errors import AppError
from app.core.metrics import BIDS
from app.db import utcnow
from app.models import AuctionStatus
from app.realtime import announce_bid
from app.schemas import AuctionOut, BidIn, BidOut, BidPlacedOut, MyAuctionOut, Page, ServerTime
from app.services import auctions as auction_service
from app.services.auctions import SortKey
from app.services.bidding import place_bid

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auctions"])

Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/time", response_model=ServerTime, tags=["meta"], summary="Server clock, for countdown sync")
async def server_time() -> ServerTime:
    return ServerTime(server_time=utcnow())


@router.get("/auctions", response_model=Page[AuctionOut], summary="Browse auctions")
async def list_auctions(
    session: SessionDep,
    status_: Annotated[list[AuctionStatus] | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: SortKey = "ending_soon",
    limit: Limit = 24,
    offset: Offset = 0,
) -> Page[AuctionOut]:
    items, total = await auction_service.list_auctions(
        session, statuses=status_, q=q, sort=sort, limit=limit, offset=offset
    )
    return Page(items=[AuctionOut.from_model(a) for a in items], total=total, limit=limit, offset=offset)


@router.get("/auctions/{auction_id}", response_model=AuctionOut, summary="Auction details")
async def get_auction(auction_id: int, session: SessionDep) -> AuctionOut:
    return AuctionOut.from_model(await auction_service.get_auction(session, auction_id))


@router.get("/auctions/{auction_id}/bids", response_model=Page[BidOut], summary="Bid history, highest first")
async def list_bids(
    auction_id: int, session: SessionDep, limit: Limit = 20, offset: Offset = 0
) -> Page[BidOut]:
    bids, total = await auction_service.list_bids(session, auction_id, limit=limit, offset=offset)
    return Page(items=[BidOut.from_model(b) for b in bids], total=total, limit=limit, offset=offset)


@router.post(
    "/auctions/{auction_id}/bids",
    response_model=BidPlacedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("bid", lambda s: s.rate_limit_bids_per_minute, by_user=True))],
    summary="Place a bid",
    responses={
        409: {"description": "BID_TOO_LOW, AUCTION_NOT_LIVE or ALREADY_LEADING"},
        403: {"description": "ADMIN_CANNOT_BID"},
        429: {"description": "RATE_LIMITED"},
    },
)
async def create_bid(
    auction_id: int,
    body: BidIn,
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    broker: BrokerDep,
) -> BidPlacedOut:
    try:
        result = await place_bid(
            session, auction_id=auction_id, bidder=user, amount=body.amount, settings=settings
        )
    except AppError as exc:
        BIDS.labels(f"rejected_{exc.code.lower()}").inc()
        logger.info(
            "bid_rejected",
            extra={"auction_id": auction_id, "user_id": user.id, "amount": body.amount, "reason": exc.code},
        )
        raise

    BIDS.labels("accepted").inc()
    logger.info(
        "bid_accepted",
        extra={
            "auction_id": auction_id,
            "user_id": user.id,
            "amount": body.amount,
            "extended": result.extended,
        },
    )
    bid, auction = await announce_bid(broker, result)
    return BidPlacedOut(bid=bid, auction=auction, extended=result.extended)


@router.get("/me/auctions", response_model=list[MyAuctionOut], tags=["me"], summary="Auctions I have bid on")
async def my_auctions(user: CurrentUser, session: SessionDep) -> list[MyAuctionOut]:
    rows = await auction_service.auctions_for_bidder(session, user.id)
    return [
        MyAuctionOut(
            auction=AuctionOut.from_model(a),
            my_highest_bid=my_max,
            is_leading=a.leading_bidder_id == user.id,
            is_winner=a.winner_id == user.id,
        )
        for a, my_max in rows
    ]
