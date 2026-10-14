from datetime import datetime, timedelta
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import (
    AnyHttpUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

from app.models import Auction, AuctionStatus, Bid, BikeCondition, User, UserRole

T = TypeVar("T")

MAX_PRICE = 100_000_000  # ₹10 crore — anything above is a typo, not a bike
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Rupees = Annotated[int, Field(gt=0, le=MAX_PRICE)]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# ---------- users & auth ----------


class RegisterIn(BaseModel):
    email: EmailStr
    full_name: Name
    password: Password


class LoginIn(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: UserRole
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class PublicUser(BaseModel):
    """What other users may see about a bidder — never their email."""

    id: int
    display_name: str

    @classmethod
    def from_user(cls, user: User | None) -> "PublicUser | None":
        return cls(id=user.id, display_name=user.display_name) if user else None


# ---------- motorcycles & auctions ----------


class MotorcycleIn(BaseModel):
    make: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    year: Annotated[int, Field(ge=1900, le=2100)]
    mileage_km: Annotated[int, Field(ge=0, le=2_000_000)]
    engine_cc: Annotated[int, Field(gt=0, le=5_000)]
    condition: BikeCondition
    color: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=40)] = None
    location: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5_000)] = ""
    image_url: AnyHttpUrl | None = None


class MotorcycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    make: str
    model: str
    year: int
    mileage_km: int
    engine_cc: int
    condition: BikeCondition
    color: str | None
    location: str
    description: str
    image_url: str | None


def _check_window(starts_at: datetime | None, ends_at: datetime | None) -> None:
    if starts_at and ends_at:
        if ends_at <= starts_at:
            raise ValueError("ends_at must be after starts_at")
        if ends_at - starts_at < timedelta(minutes=1):
            raise ValueError("an auction must run for at least 1 minute")
        if ends_at - starts_at > timedelta(days=30):
            raise ValueError("an auction may run for at most 30 days")


def _check_prices(starting: int | None, reserve: int | None) -> None:
    if starting is not None and reserve is not None and reserve < starting:
        raise ValueError("reserve_price cannot be below starting_price")


class AuctionCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=140)]
    motorcycle: MotorcycleIn
    starting_price: Rupees
    reserve_price: Rupees | None = None
    min_increment: Annotated[int, Field(gt=0, le=10_000_000)] = 500
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def _validate(self) -> "AuctionCreate":
        _check_window(self.starts_at, self.ends_at)
        _check_prices(self.starting_price, self.reserve_price)
        return self


class AuctionUpdate(BaseModel):
    """Partial update; only allowed before the auction goes live."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=140)] | None = None
    motorcycle: MotorcycleIn | None = None
    starting_price: Rupees | None = None
    reserve_price: Rupees | None = None
    min_increment: Annotated[int, Field(gt=0, le=10_000_000)] | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None


class CancelIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""


class AuctionOut(BaseModel):
    id: int
    title: str
    status: AuctionStatus
    starting_price: int
    current_price: int
    min_increment: int
    next_min_bid: int
    bid_count: int
    has_reserve: bool
    reserve_met: bool
    leading_bidder: PublicUser | None
    winner: PublicUser | None
    starts_at: datetime
    ends_at: datetime
    extension_count: int
    ended_at: datetime | None
    motorcycle: MotorcycleOut

    @classmethod
    def from_model(cls, a: Auction) -> "AuctionOut":
        return cls(
            id=a.id,
            title=a.title,
            status=a.status,
            starting_price=a.starting_price,
            current_price=a.current_price,
            min_increment=a.min_increment,
            next_min_bid=a.next_min_bid,
            bid_count=a.bid_count,
            # The reserve amount is secret (it's the seller's floor); only whether one exists is public.
            has_reserve=a.reserve_price is not None,
            reserve_met=a.reserve_met,
            leading_bidder=PublicUser.from_user(a.leading_bidder),
            winner=PublicUser.from_user(a.winner),
            starts_at=a.starts_at,
            ends_at=a.ends_at,
            extension_count=a.extension_count,
            ended_at=a.ended_at,
            motorcycle=MotorcycleOut.model_validate(a.motorcycle),
        )


class AdminAuctionOut(AuctionOut):
    reserve_price: int | None
    created_at: datetime

    @classmethod
    def from_model(cls, a: Auction) -> "AdminAuctionOut":
        return cls(
            **AuctionOut.from_model(a).model_dump(),
            reserve_price=a.reserve_price,
            created_at=a.created_at,
        )


# ---------- bids ----------


class BidIn(BaseModel):
    amount: Rupees


class BidOut(BaseModel):
    id: int
    auction_id: int
    amount: int
    created_at: datetime
    bidder: PublicUser

    @classmethod
    def from_model(cls, bid: Bid) -> "BidOut":
        return cls(
            id=bid.id,
            auction_id=bid.auction_id,
            amount=bid.amount,
            created_at=bid.created_at,
            bidder=PublicUser.from_user(bid.bidder),  # type: ignore[arg-type]
        )


class BidPlacedOut(BaseModel):
    bid: BidOut
    auction: AuctionOut
    extended: bool


class MyAuctionOut(BaseModel):
    auction: AuctionOut
    my_highest_bid: int
    is_leading: bool
    is_winner: bool


# ---------- admin & misc ----------


class AdminStats(BaseModel):
    users: int
    auctions_by_status: dict[AuctionStatus, int]
    total_bids: int
    bids_last_hour: int
    gross_sales: int


class ServerTime(BaseModel):
    server_time: datetime
