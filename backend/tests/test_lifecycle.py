from datetime import UTC, datetime, timedelta

from app.db import SessionFactory
from app.models import Auction
from app.services.lifecycle import advance_lifecycle
from tests.conftest import admin_token, auth, create_auction, register, set_auction_times


async def tick(now=None):
    async with SessionFactory() as session:
        return await advance_lifecycle(session, now or datetime.now(UTC))


async def fetch(auction_id: int) -> Auction:
    async with SessionFactory() as session:
        return await session.get(Auction, auction_id)


async def test_scheduled_auction_goes_live_when_due(client):
    start = datetime.now(UTC) + timedelta(minutes=10)
    auction = await create_auction(
        client, await admin_token(client), starts_at=start.isoformat(), ends_at=(start + timedelta(hours=1)).isoformat()
    )
    started, ended = await tick()
    assert (started, ended) == ([], [])

    started, _ = await tick(start + timedelta(seconds=1))
    assert started == [auction["id"]]
    assert (await fetch(auction["id"])).status == "live"

    # Idempotent: a second tick (or a second instance) changes nothing.
    assert await tick(start + timedelta(seconds=2)) == ([], [])


async def test_auction_ends_with_winner_when_reserve_met(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, reserve_price=100_000)
    token, user = await register(client)
    await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000}, headers=auth(token))

    _, ended = await tick(datetime.now(UTC) + timedelta(hours=2))
    assert ended == [auction["id"]]
    stored = await fetch(auction["id"])
    assert stored.status == "ended"
    assert stored.winner_id == user["id"]
    assert stored.ended_at is not None


async def test_auction_ends_without_winner_when_reserve_not_met(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, reserve_price=200_000)
    token, _ = await register(client)
    await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 150_000}, headers=auth(token))

    await tick(datetime.now(UTC) + timedelta(hours=2))
    stored = await fetch(auction["id"])
    assert stored.status == "ended"
    assert stored.winner_id is None


async def test_auction_with_no_bids_ends_unsold(client):
    auction = await create_auction(client, await admin_token(client))
    await tick(datetime.now(UTC) + timedelta(hours=2))
    stored = await fetch(auction["id"])
    assert stored.status == "ended" and stored.winner_id is None


async def test_extended_auction_is_not_closed_at_its_original_end(client):
    auction = await create_auction(client, await admin_token(client))
    now = datetime.now(UTC)
    original_end = now + timedelta(seconds=20)
    await set_auction_times(auction["id"], ends_at=original_end)
    token, _ = await register(client)
    resp = await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000}, headers=auth(token))
    assert resp.json()["extended"] is True

    _, ended = await tick(original_end + timedelta(seconds=1))
    assert ended == []
    assert (await fetch(auction["id"])).status == "live"


async def test_cancelled_auction_is_never_restarted(client):
    admin = await admin_token(client)
    start = datetime.now(UTC) + timedelta(minutes=5)
    auction = await create_auction(
        client, admin, starts_at=start.isoformat(), ends_at=(start + timedelta(hours=1)).isoformat()
    )
    await client.post(f"/api/v1/admin/auctions/{auction['id']}/cancel", json={}, headers=auth(admin))
    assert await tick(start + timedelta(minutes=1)) == ([], [])
    assert (await fetch(auction["id"])).status == "cancelled"
