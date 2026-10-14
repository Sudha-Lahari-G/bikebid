"""Tests run against a real PostgreSQL database (row locks and constraints are
part of what we're testing — SQLite would hide exactly the bugs that matter).

Set TEST_DATABASE_URL; docker compose already does:
    docker compose run --rm api pytest
"""

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest

_test_url = os.environ.get("TEST_DATABASE_URL")
if not _test_url:
    raise RuntimeError("TEST_DATABASE_URL must point at a disposable PostgreSQL database")

os.environ.update(
    ENVIRONMENT="test",
    DATABASE_URL=_test_url,
    REDIS_URL="",
    SCHEDULER_ENABLED="false",
    DEMO_MODE="false",
    ADMIN_EMAIL="",
    ADMIN_PASSWORD="",
    LOG_JSON="false",
    LOG_LEVEL="WARNING",
    RATE_LIMIT_BIDS_PER_MINUTE="1000",
    RATE_LIMIT_AUTH_PER_MINUTE="1000",
    JWT_SECRET="test-secret-test-secret-test-secret-123",
)


def _ensure_test_database(url: str) -> None:
    plain = url.replace("postgresql+psycopg://", "postgresql://")
    base, _, name = plain.rpartition("/")
    name = name.split("?")[0]
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{name}"')


_ensure_test_database(_test_url)

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db import Base, SessionFactory, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import UserRole  # noqa: E402
from app.services import users as user_service  # noqa: E402

PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    import asyncio

    async def create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create())


@pytest.fixture(autouse=True)
async def _clean_tables() -> AsyncIterator[None]:
    yield
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE bids, auctions, motorcycles, users RESTART IDENTITY CASCADE"))


@pytest.fixture
async def app():
    application = create_app(get_settings())
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: httpx.AsyncClient, name: str = "Test Rider") -> tuple[str, dict[str, Any]]:
    email = f"{uuid.uuid4().hex[:10]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "full_name": name, "password": PASSWORD}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], body["user"]


async def admin_token(client: httpx.AsyncClient) -> str:
    async with SessionFactory() as session:
        await user_service.ensure_user(
            session, email="admin@example.com", full_name="Ada Admin", password=PASSWORD, role=UserRole.ADMIN
        )
    resp = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auction_payload(**overrides: Any) -> dict[str, Any]:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "title": "2022 Royal Enfield Classic 350",
        "motorcycle": {
            "make": "Royal Enfield",
            "model": "Classic 350",
            "year": 2022,
            "mileage_km": 8200,
            "engine_cc": 349,
            "condition": "good",
            "color": "Stealth Black",
            "location": "Hyderabad, TS",
            "description": "Single owner.",
        },
        "starting_price": 100_000,
        "reserve_price": None,
        "min_increment": 1_000,
        "starts_at": (now - timedelta(seconds=5)).isoformat(),
        "ends_at": (now + timedelta(hours=1)).isoformat(),
    }
    payload.update(overrides)
    return payload


async def create_auction(client: httpx.AsyncClient, token: str, **overrides: Any) -> dict[str, Any]:
    resp = await client.post("/api/v1/admin/auctions", json=auction_payload(**overrides), headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def set_auction_times(auction_id: int, *, starts_at=None, ends_at=None) -> None:
    """Move an auction's clock directly in the DB (the API rightly refuses past times)."""
    fields, params = [], {"id": auction_id}
    if starts_at is not None:
        fields.append("starts_at = :starts_at")
        params["starts_at"] = starts_at
    if ends_at is not None:
        fields.append("ends_at = :ends_at")
        params["ends_at"] = ends_at
    async with engine.begin() as conn:
        await conn.execute(text(f"UPDATE auctions SET {', '.join(fields)} WHERE id = :id"), params)
