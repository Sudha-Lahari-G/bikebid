from datetime import UTC, datetime, timedelta

from tests.conftest import admin_token, auction_payload, auth, create_auction, register


async def test_only_admins_can_create_auctions(client):
    token, _ = await register(client)
    resp = await client.post("/api/v1/admin/auctions", json=auction_payload(), headers=auth(token))
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "ADMIN_ONLY"


async def test_auction_starting_now_is_live_immediately(client):
    auction = await create_auction(client, await admin_token(client))
    assert auction["status"] == "live"
    assert auction["current_price"] == auction["starting_price"] == auction["next_min_bid"]


async def test_future_auction_is_scheduled(client):
    start = datetime.now(UTC) + timedelta(hours=1)
    auction = await create_auction(
        client,
        await admin_token(client),
        starts_at=start.isoformat(),
        ends_at=(start + timedelta(hours=2)).isoformat(),
    )
    assert auction["status"] == "scheduled"


async def test_invalid_schedule_and_prices_are_rejected(client):
    token = await admin_token(client)
    now = datetime.now(UTC)
    backwards = auction_payload(starts_at=now.isoformat(), ends_at=(now - timedelta(hours=1)).isoformat())
    assert (await client.post("/api/v1/admin/auctions", json=backwards, headers=auth(token))).status_code == 422

    low_reserve = auction_payload(starting_price=50_000, reserve_price=10_000)
    assert (await client.post("/api/v1/admin/auctions", json=low_reserve, headers=auth(token))).status_code == 422

    naive_time = auction_payload(starts_at="2030-01-01T10:00:00", ends_at="2030-01-01T12:00:00")
    assert (await client.post("/api/v1/admin/auctions", json=naive_time, headers=auth(token))).status_code == 422


async def test_reserve_price_is_hidden_from_the_public(client):
    token = await admin_token(client)
    auction = await create_auction(client, token, reserve_price=150_000)
    assert auction["reserve_price"] == 150_000  # the admin response includes it

    public = (await client.get(f"/api/v1/auctions/{auction['id']}")).json()
    assert "reserve_price" not in public
    assert public["has_reserve"] is True
    assert public["reserve_met"] is False


async def test_list_filters_search_and_paginates(client):
    token = await admin_token(client)
    await create_auction(client, token, title="2021 KTM 390 Duke")
    await create_auction(client, token, title="2020 Bajaj Dominar 400")
    start = datetime.now(UTC) + timedelta(days=1)
    await create_auction(
        client, token, starts_at=start.isoformat(), ends_at=(start + timedelta(hours=3)).isoformat()
    )

    live = (await client.get("/api/v1/auctions", params={"status": "live"})).json()
    assert live["total"] == 2

    search = (await client.get("/api/v1/auctions", params={"q": "ktm"})).json()
    assert [a["title"] for a in search["items"]] == ["2021 KTM 390 Duke"]

    # LIKE wildcards in the search box are treated literally
    assert (await client.get("/api/v1/auctions", params={"q": "%"})).json()["total"] == 0

    page = (await client.get("/api/v1/auctions", params={"limit": 2, "offset": 2})).json()
    assert page["total"] == 3 and len(page["items"]) == 1


async def test_unknown_auction_is_404(client):
    resp = await client.get("/api/v1/auctions/999999")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "AUCTION_NOT_FOUND"


async def test_only_scheduled_auctions_can_be_edited(client):
    token = await admin_token(client)
    live = await create_auction(client, token)
    resp = await client.patch(
        f"/api/v1/admin/auctions/{live['id']}", json={"title": "New title"}, headers=auth(token)
    )
    assert resp.status_code == 409

    start = datetime.now(UTC) + timedelta(hours=2)
    scheduled = await create_auction(
        client, token, starts_at=start.isoformat(), ends_at=(start + timedelta(hours=1)).isoformat()
    )
    resp = await client.patch(
        f"/api/v1/admin/auctions/{scheduled['id']}",
        json={"title": "2022 Classic 350 — Signals edition", "starting_price": 90_000},
        headers=auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "2022 Classic 350 — Signals edition"
    assert resp.json()["current_price"] == 90_000


async def test_cancel_auction(client):
    token = await admin_token(client)
    auction = await create_auction(client, token)
    resp = await client.post(
        f"/api/v1/admin/auctions/{auction['id']}/cancel", json={"reason": "Seller withdrew"}, headers=auth(token)
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    again = await client.post(f"/api/v1/admin/auctions/{auction['id']}/cancel", json={}, headers=auth(token))
    assert again.status_code == 409


async def test_admin_stats(client):
    token = await admin_token(client)
    await create_auction(client, token)
    stats = (await client.get("/api/v1/admin/stats", headers=auth(token))).json()
    assert stats["auctions_by_status"]["live"] == 1
    assert stats["users"] == 1
