from datetime import UTC, datetime, timedelta

from tests.conftest import admin_token, auth, create_auction, register, set_auction_times


async def bid(client, auction_id: int, token: str, amount: int):
    return await client.post(f"/api/v1/auctions/{auction_id}/bids", json={"amount": amount}, headers=auth(token))


async def test_first_bid_at_starting_price_is_accepted(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, min_increment=1_000)
    token, user = await register(client, "Asha Verma")

    resp = await bid(client, auction["id"], token, 100_000)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["auction"]["current_price"] == 100_000
    assert body["auction"]["bid_count"] == 1
    assert body["auction"]["next_min_bid"] == 101_000
    assert body["auction"]["leading_bidder"] == {"id": user["id"], "display_name": "Asha V."}
    assert body["bid"]["bidder"]["display_name"] == "Asha V."


async def test_bid_below_minimum_is_rejected_with_the_minimum(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, min_increment=1_000)
    first, _ = await register(client)
    second, _ = await register(client)
    await bid(client, auction["id"], first, 100_000)

    resp = await bid(client, auction["id"], second, 100_500)
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "BID_TOO_LOW"
    assert error["details"]["min_bid"] == 101_000


async def test_cannot_outbid_yourself(client):
    auction = await create_auction(client, await admin_token(client))
    token, _ = await register(client)
    await bid(client, auction["id"], token, 100_000)
    resp = await bid(client, auction["id"], token, 120_000)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "ALREADY_LEADING"


async def test_admins_cannot_bid(client):
    admin = await admin_token(client)
    auction = await create_auction(client, admin)
    resp = await bid(client, auction["id"], admin, 100_000)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "ADMIN_CANNOT_BID"


async def test_bidding_requires_login(client):
    auction = await create_auction(client, await admin_token(client))
    resp = await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000})
    assert resp.status_code == 401


async def test_cannot_bid_on_scheduled_or_cancelled_auctions(client):
    admin = await admin_token(client)
    start = datetime.now(UTC) + timedelta(hours=1)
    scheduled = await create_auction(
        client, admin, starts_at=start.isoformat(), ends_at=(start + timedelta(hours=1)).isoformat()
    )
    token, _ = await register(client)
    assert (await bid(client, scheduled["id"], token, 100_000)).json()["error"]["code"] == "AUCTION_NOT_LIVE"

    live = await create_auction(client, admin)
    await client.post(f"/api/v1/admin/auctions/{live['id']}/cancel", json={}, headers=auth(admin))
    assert (await bid(client, live["id"], token, 100_000)).json()["error"]["code"] == "AUCTION_NOT_LIVE"


async def test_bid_after_end_time_is_rejected_even_before_scheduler_runs(client):
    auction = await create_auction(client, await admin_token(client))
    now = datetime.now(UTC)
    await set_auction_times(auction["id"], starts_at=now - timedelta(hours=1), ends_at=now - timedelta(seconds=1))
    token, _ = await register(client)
    resp = await bid(client, auction["id"], token, 100_000)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "AUCTION_NOT_LIVE"


async def test_last_minute_bid_extends_the_auction(client):
    auction = await create_auction(client, await admin_token(client))
    now = datetime.now(UTC)
    await set_auction_times(auction["id"], ends_at=now + timedelta(seconds=30))
    token, _ = await register(client)

    resp = await bid(client, auction["id"], token, 100_000)
    assert resp.status_code == 201
    body = resp.json()
    assert body["extended"] is True
    assert body["auction"]["extension_count"] == 1
    new_end = datetime.fromisoformat(body["auction"]["ends_at"])
    assert new_end >= now + timedelta(seconds=115)


async def test_early_bid_does_not_extend(client):
    auction = await create_auction(client, await admin_token(client))
    token, _ = await register(client)
    body = (await bid(client, auction["id"], token, 100_000)).json()
    assert body["extended"] is False
    assert body["auction"]["ends_at"] == auction["ends_at"]


async def test_bid_history_and_my_auctions(client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000, min_increment=1_000)
    alice, _ = await register(client, "Alice Fernandes")
    bob, _ = await register(client, "Bob Thomas")
    await bid(client, auction["id"], alice, 100_000)
    await bid(client, auction["id"], bob, 105_000)
    await bid(client, auction["id"], alice, 110_000)

    history = (await client.get(f"/api/v1/auctions/{auction['id']}/bids")).json()
    assert history["total"] == 3
    assert [b["amount"] for b in history["items"]] == [110_000, 105_000, 100_000]
    assert "email" not in history["items"][0]["bidder"]

    bobs = (await client.get("/api/v1/me/auctions", headers=auth(bob))).json()
    assert len(bobs) == 1
    assert bobs[0]["my_highest_bid"] == 105_000
    assert bobs[0]["is_leading"] is False

    alices = (await client.get("/api/v1/me/auctions", headers=auth(alice))).json()
    assert alices[0]["is_leading"] is True
