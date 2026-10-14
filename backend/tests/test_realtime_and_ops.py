import json

from app.realtime import FEED_CHANNEL, auction_channel
from tests.conftest import admin_token, auth, create_auction, register


class FakeSocket:
    def __init__(self, fail: bool = False) -> None:
        self.messages: list[dict] = []
        self.fail = fail

    async def accept(self) -> None:
        return None

    async def send_text(self, text: str) -> None:
        if self.fail:
            raise ConnectionError("client went away")
        self.messages.append(json.loads(text))


async def test_accepted_bid_is_pushed_to_watchers(app, client):
    auction = await create_auction(client, await admin_token(client))
    room, feed = FakeSocket(), FakeSocket()
    await app.state.hub.connect(room, auction_channel(auction["id"]))
    await app.state.hub.connect(feed, FEED_CHANNEL)

    token, user = await register(client)
    await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000}, headers=auth(token))

    assert [m["type"] for m in room.messages] == ["bid.placed"]
    event = room.messages[0]
    assert event["bid"]["amount"] == 100_000
    assert event["auction"]["leading_bidder"]["id"] == user["id"]
    assert event["previous_leader_id"] is None
    assert feed.messages[0]["type"] == "auction.updated"
    assert feed.messages[0]["auction"]["current_price"] == 100_000


async def test_rejected_bid_is_not_broadcast(app, client):
    auction = await create_auction(client, await admin_token(client), starting_price=100_000)
    room = FakeSocket()
    await app.state.hub.connect(room, auction_channel(auction["id"]))
    token, _ = await register(client)
    await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 1_000}, headers=auth(token))
    assert room.messages == []


async def test_dead_socket_is_dropped_without_affecting_others(app, client):
    auction = await create_auction(client, await admin_token(client))
    channel = auction_channel(auction["id"])
    healthy, dead = FakeSocket(), FakeSocket(fail=True)
    await app.state.hub.connect(healthy, channel)
    await app.state.hub.connect(dead, channel)

    token, _ = await register(client)
    await client.post(f"/api/v1/auctions/{auction['id']}/bids", json={"amount": 100_000}, headers=auth(token))
    assert len(healthy.messages) == 1
    assert app.state.hub.count(channel) == 1


async def test_health_endpoints(client):
    assert (await client.get("/health/live")).json() == {"status": "ok"}
    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"


async def test_request_id_is_echoed_and_generated(client):
    resp = await client.get("/api/v1/time", headers={"X-Request-ID": "trace-abc-123"})
    assert resp.headers["X-Request-ID"] == "trace-abc-123"
    generated = await client.get("/api/v1/time")
    assert len(generated.headers["X-Request-ID"]) == 32
    assert generated.headers["X-Content-Type-Options"] == "nosniff"


async def test_metrics_are_exposed(client):
    await client.get("/api/v1/auctions")
    body = (await client.get("/metrics")).text
    assert "http_requests_total" in body
    assert 'route="/api/v1/auctions"' in body
    assert "bids_total" in body or "websocket_connections" in body


async def test_errors_have_a_consistent_shape(client):
    resp = await client.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    assert set(resp.json()["error"]) == {"code", "message", "details"}
