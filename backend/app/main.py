import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api import admin, auctions, auth, ops
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.ratelimit import InMemoryRateLimiter, RedisRateLimiter
from app.db import SessionFactory, engine
from app.models import UserRole
from app.realtime import ConnectionHub, InMemoryBroker, RedisBroker
from app.services import users as user_service
from app.services.lifecycle import AuctionScheduler, ensure_demo_bidders

logger = logging.getLogger("app")

API_DESCRIPTION = """
Live auctions for used motorcycles.

* **Browse** auctions and bid history without an account.
* **Bid** with a JWT from `/api/v1/auth/login` (click *Authorize* and paste the token).
* **Watch live** over WebSockets: `/ws/auctions/{id}` for one auction, `/ws/feed` for all.

Errors always look like `{"error": {"code": "BID_TOO_LOW", "message": "...", "details": {...}}}`.
"""


async def _bootstrap_accounts(settings: Settings) -> None:
    async with SessionFactory() as session:
        if settings.admin_email and settings.admin_password:
            await user_service.ensure_user(
                session,
                email=settings.admin_email,
                full_name="Platform Admin",
                password=settings.admin_password,
                role=UserRole.ADMIN,
            )
        if settings.demo_mode:
            await ensure_demo_bidders(session, password=None)
            if settings.demo_user_password:
                await user_service.ensure_user(
                    session,
                    email=settings.demo_user_email,
                    full_name="Demo Rider",
                    password=settings.demo_user_password,
                    role=UserRole.USER,
                )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    hub = ConnectionHub()
    redis = Redis.from_url(settings.redis_url) if settings.redis_url else None
    broker = RedisBroker(hub, redis) if redis else InMemoryBroker(hub)

    app.state.hub = hub
    app.state.redis = redis
    app.state.broker = broker
    app.state.rate_limiter = RedisRateLimiter(redis) if redis else InMemoryRateLimiter()
    app.state.scheduler = None

    await broker.start()
    await _bootstrap_accounts(settings)
    if settings.scheduler_enabled:
        app.state.scheduler = AuctionScheduler(SessionFactory, broker, settings)
        await app.state.scheduler.start()

    logger.info(
        "startup_complete",
        extra={
            "environment": settings.environment,
            "realtime": "redis" if redis else "in-memory",
            "demo_mode": settings.demo_mode,
        },
    )
    try:
        yield
    finally:
        if app.state.scheduler:
            await app.state.scheduler.stop()
        await broker.stop()
        if redis:
            await redis.aclose()
        await engine.dispose()
        logger.info("shutdown_complete")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    app = FastAPI(
        title="BikeBid API",
        version="1.0.0",
        description=API_DESCRIPTION,
        lifespan=lifespan,
    )
    app.state.settings = settings

    # Order matters: the outermost middleware is added last.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )
    register_error_handlers(app)

    api = APIRouter(prefix="/api/v1")
    api.include_router(auth.router)
    api.include_router(auctions.router)
    api.include_router(admin.router)
    app.include_router(api)
    app.include_router(ops.router)
    return app


app = create_app()
