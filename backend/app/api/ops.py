"""Operational endpoints: liveness, readiness, Prometheus metrics, WebSockets."""

import asyncio
import hmac
import logging
import time

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.config import get_settings
from app.core.errors import UnauthorizedError
from app.db import check_database, utcnow
from app.realtime import FEED_CHANNEL, ConnectionHub, auction_channel

logger = logging.getLogger(__name__)

router = APIRouter()

_WS_IDLE_TIMEOUT_SECONDS = 90  # clients ping every 25s


@router.get("/health/live", tags=["ops"], summary="Process is up")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", tags=["ops"], summary="Dependencies are reachable")
async def ready(request: Request) -> JSONResponse:
    checks: dict[str, str] = {}
    try:
        await asyncio.wait_for(check_database(), 3)
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"

    redis = getattr(request.app.state, "redis", None)
    if redis is not None:
        try:
            await asyncio.wait_for(redis.ping(), 2)
            checks["redis"] = "ok"
        except Exception as exc:
            checks["redis"] = f"error: {type(exc).__name__}"
    else:
        checks["redis"] = "disabled"

    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is not None:
        last = scheduler.last_tick_ok_at
        stale = last is None or time.time() - last > 30
        checks["scheduler"] = "stale" if stale else "ok"

    healthy = checks["database"] == "ok" and not checks.get("redis", "").startswith("error")
    return JSONResponse(
        {"status": "ok" if healthy else "degraded", "checks": checks},
        status_code=200 if healthy else 503,
    )


@router.get("/metrics", tags=["ops"], summary="Prometheus metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    token = get_settings().metrics_token
    if token:
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(supplied, token):
            raise UnauthorizedError("Metrics token required")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


async def _serve(websocket: WebSocket, channel: str) -> None:
    hub: ConnectionHub = websocket.app.state.hub
    await hub.connect(websocket, channel)
    try:
        await websocket.send_json({"type": "hello", "channel": channel, "server_time": utcnow().isoformat()})
        while True:
            # The stream is server -> client; the client only sends keep-alive pings.
            message = await asyncio.wait_for(websocket.receive_text(), _WS_IDLE_TIMEOUT_SECONDS)
            if message == "ping":
                await websocket.send_json({"type": "pong", "server_time": utcnow().isoformat()})
    except (TimeoutError, WebSocketDisconnect):
        pass
    except Exception:
        logger.warning("websocket_error", extra={"channel": channel}, exc_info=True)
    finally:
        hub.disconnect(websocket, channel)


@router.websocket("/ws/auctions/{auction_id}")
async def auction_socket(websocket: WebSocket, auction_id: int) -> None:
    """Bids and status changes for one auction."""
    await _serve(websocket, auction_channel(auction_id))


@router.websocket("/ws/feed")
async def feed_socket(websocket: WebSocket) -> None:
    """Price and status updates for every auction (for the listing page)."""
    await _serve(websocket, FEED_CHANNEL)
