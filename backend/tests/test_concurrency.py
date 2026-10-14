"""The race conditions an auction system must survive.

Requests run concurrently through the real ASGI app, each with its own
database session and connection, so they genuinely contend for the auction's
row lock in PostgreSQL.
"""

import asyncio

from sqlalchemy import func, select

from app.db import SessionFactory
from app.models import Auction, Bid
from tests.conftest import admin_token, auth, create_auction, register

N = 15


async def test_simultaneous_identical_bids_exactly_one_wins(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, min_increment=1_000)
    tokens = [(await register(client, f"Rider {i}"))[0] for i in range(N)]

    responses = await asyncio.gather(
        *(
            client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000}, headers=auth(t))
            for t in tokens
        )
    )
    codes = sorted(r.status_code for r in responses)
    assert codes.count(201) == 1, codes
    assert codes.count(409) == N - 1
    assert {r.json()["error"]["code"] for r in responses if r.status_code == 409} == {"BID_TOO_LOW"}

    async with SessionFactory() as session:
        stored = await session.get(Auction, auction["id"])
        bid_rows = await session.scalar(select(func.count()).where(Bid.auction_id == auction["id"]))
    assert stored.bid_count == bid_rows == 1
    assert stored.current_price == 100_000


async def test_concurrent_rising_bids_leave_consistent_state(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, min_increment=1_000)
    tokens = [(await register(client, f"Rider {i}"))[0] for i in range(N)]
    amounts = [100_000 + i * 1_000 for i in range(N)]

    responses = await asyncio.gather(
        *(
            client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": a}, headers=auth(t))
            for t, a in zip(tokens, amounts, strict=True)
        )
    )
    accepted = [a for a, r in zip(amounts, responses, strict=True) if r.status_code == 201]
    assert accepted, "at least one bid must win"
    assert all(r.status_code in (201, 409) for r in responses)

    async with SessionFactory() as session:
        stored = await session.get(Auction, auction["id"])
        rows = list(
            (await session.execute(select(Bid.amount).where(Bid.auction_id == auction["id"]).order_by(Bid.id)))
            .scalars()
        )

    # Every accepted bid is persisted, in strictly increasing order of acceptance,
    # and the auction's denormalised fields agree with the bid table.
    assert sorted(rows) == sorted(accepted)
    assert rows == sorted(rows)
    assert stored.bid_count == len(rows)
    assert stored.current_price == max(rows)


async def test_bids_on_different_auctions_do_not_interfere(client):
    admin = await admin_token(client)
    auctions = [await create_auction(client, admin, starting_price=50_000) for _ in range(5)]
    tokens = [(await register(client))[0] for _ in auctions]

    responses = await asyncio.gather(
        *(
            client.post(f"/api/v1/auctions/{a['id']}/bids", json={"amount": 50_000}, headers=auth(t))
            for a, t in zip(auctions, tokens, strict=True)
        )
    )
    assert [r.status_code for r in responses] == [201] * len(auctions)
