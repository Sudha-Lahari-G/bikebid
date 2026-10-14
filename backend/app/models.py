from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Money is stored as whole rupees in BIGINT columns: exact, no float rounding,
# and bikes are never priced in paise.


def _pg_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    return Enum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class BikeCondition(StrEnum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    PROJECT = "project"


class AuctionStatus(StrEnum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(_pg_enum(UserRole, "user_role"), default=UserRole.USER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def display_name(self) -> str:
        """Public name shown next to bids: first name + last initial ("Ravi K.")."""
        parts = self.full_name.split()
        if len(parts) == 1:
            return parts[0]
        return f"{parts[0]} {parts[-1][0]}."


class Motorcycle(Base):
    __tablename__ = "motorcycles"

    id: Mapped[int] = mapped_column(primary_key=True)
    make: Mapped[str] = mapped_column(String(60))
    model: Mapped[str] = mapped_column(String(80))
    year: Mapped[int] = mapped_column(Integer)
    mileage_km: Mapped[int] = mapped_column(Integer)
    engine_cc: Mapped[int] = mapped_column(Integer)
    condition: Mapped[BikeCondition] = mapped_column(_pg_enum(BikeCondition, "bike_condition"))
    color: Mapped[str | None] = mapped_column(String(40))
    location: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("year BETWEEN 1900 AND 2100", name="year_range"),
        CheckConstraint("mileage_km >= 0", name="mileage_non_negative"),
        CheckConstraint("engine_cc > 0", name="engine_cc_positive"),
    )


class Auction(Base):
    __tablename__ = "auctions"

    id: Mapped[int] = mapped_column(primary_key=True)
    motorcycle_id: Mapped[int] = mapped_column(
        ForeignKey("motorcycles.id", ondelete="RESTRICT"), unique=True
    )
    title: Mapped[str] = mapped_column(String(140))
    status: Mapped[AuctionStatus] = mapped_column(
        _pg_enum(AuctionStatus, "auction_status"), default=AuctionStatus.SCHEDULED
    )
    starting_price: Mapped[int] = mapped_column(BigInteger)
    reserve_price: Mapped[int | None] = mapped_column(BigInteger)
    min_increment: Mapped[int] = mapped_column(BigInteger)
    current_price: Mapped[int] = mapped_column(BigInteger)
    bid_count: Mapped[int] = mapped_column(Integer, default=0)
    leading_bidder_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    extension_count: Mapped[int] = mapped_column(Integer, default=0)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # lazy="raise": every query must say what it loads, so N+1 queries and
    # accidental sync IO under asyncio fail loudly in development.
    motorcycle: Mapped[Motorcycle] = relationship(lazy="raise")
    leading_bidder: Mapped[User | None] = relationship(foreign_keys=[leading_bidder_id], lazy="raise")
    winner: Mapped[User | None] = relationship(foreign_keys=[winner_id], lazy="raise")

    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        CheckConstraint("starting_price > 0", name="starting_price_positive"),
        CheckConstraint("min_increment > 0", name="min_increment_positive"),
        CheckConstraint("current_price >= starting_price", name="price_not_below_start"),
        CheckConstraint(
            "reserve_price IS NULL OR reserve_price >= starting_price", name="reserve_at_least_start"
        ),
        # The scheduler scans by (status, starts_at) and (status, ends_at) every second.
        Index("ix_auctions_status_starts_at", "status", "starts_at"),
        Index("ix_auctions_status_ends_at", "status", "ends_at"),
    )

    @property
    def next_min_bid(self) -> int:
        if self.bid_count == 0:
            return self.starting_price
        return self.current_price + self.min_increment

    @property
    def reserve_met(self) -> bool:
        return self.bid_count > 0 and (
            self.reserve_price is None or self.current_price >= self.reserve_price
        )


class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    auction_id: Mapped[int] = mapped_column(ForeignKey("auctions.id", ondelete="CASCADE"))
    bidder_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    amount: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bidder: Mapped[User] = relationship(lazy="raise")
    auction: Mapped[Auction] = relationship(lazy="raise")

    __table_args__ = (
        # Defence in depth: even if application locking were bypassed, the
        # database refuses two bids of the same amount on one auction.
        UniqueConstraint("auction_id", "amount", name="uq_bids_auction_amount"),
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_bids_auction_id_created_at", "auction_id", "created_at"),
        Index("ix_bids_bidder_id", "bidder_id"),
    )
