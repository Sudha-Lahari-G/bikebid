import logging
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import AdminUser, BrokerDep, SessionDep
from app.models import AuctionStatus
from app.realtime import broadcast_auction
from app.schemas import AdminAuctionOut, AdminStats, AuctionCreate, AuctionOut, AuctionUpdate, CancelIn, Page
from app.services import auctions as auction_service
from app.services.auctions import SortKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStats, summary="Dashboard numbers")
async def stats(_: AdminUser, session: SessionDep) -> AdminStats:
    return await auction_service.admin_stats(session)


@router.get("/auctions", response_model=Page[AdminAuctionOut], summary="All auctions, including reserve prices")
async def list_auctions(
    _: AdminUser,
    session: SessionDep,
    status_: Annotated[list[AuctionStatus] | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: SortKey = "newest",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdminAuctionOut]:
    items, total = await auction_service.list_auctions(
        session, statuses=status_, q=q, sort=sort, limit=limit, offset=offset
    )
    return Page(
        items=[AdminAuctionOut.from_model(a) for a in items], total=total, limit=limit, offset=offset
    )


@router.post(
    "/auctions",
    response_model=AdminAuctionOut,
    status_code=status.HTTP_201_CREATED,
    summary="List a motorcycle for auction",
)
async def create_auction(
    body: AuctionCreate, admin: AdminUser, session: SessionDep, broker: BrokerDep
) -> AdminAuctionOut:
    auction = await auction_service.create_auction(session, body, admin)
    logger.info("auction_created", extra={"auction_id": auction.id, "admin_id": admin.id})
    await broadcast_auction(broker, AuctionOut.from_model(auction), "created")
    return AdminAuctionOut.from_model(auction)


@router.patch("/auctions/{auction_id}", response_model=AdminAuctionOut, summary="Edit a scheduled auction")
async def update_auction(
    auction_id: int, body: AuctionUpdate, admin: AdminUser, session: SessionDep, broker: BrokerDep
) -> AdminAuctionOut:
    auction = await auction_service.update_auction(session, auction_id, body)
    logger.info("auction_updated", extra={"auction_id": auction.id, "admin_id": admin.id})
    await broadcast_auction(broker, AuctionOut.from_model(auction), "edited")
    return AdminAuctionOut.from_model(auction)


@router.post("/auctions/{auction_id}/cancel", response_model=AdminAuctionOut, summary="Cancel an auction")
async def cancel_auction(
    auction_id: int, body: CancelIn, admin: AdminUser, session: SessionDep, broker: BrokerDep
) -> AdminAuctionOut:
    auction = await auction_service.cancel_auction(session, auction_id)
    logger.warning(
        "auction_cancelled",
        extra={"auction_id": auction.id, "admin_id": admin.id, "reason": body.reason},
    )
    await broadcast_auction(broker, AuctionOut.from_model(auction), "cancelled")
    return AdminAuctionOut.from_model(auction)
