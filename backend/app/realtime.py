"""Realtime fan-out.

Each API instance keeps its own WebSocket connections in a `ConnectionHub`.
Events are published through a `Broker`:

* `InMemoryBroker` delivers straight to the local hub (single instance / tests).
* `RedisBroker` publishes to Redis pub/sub; every instance subscribes and
  delivers to its own sockets — so a bid accepted on instance A reaches a
  browser connected to instance B.
"""

import asyncio
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from fastapi import WebSocket
from redis.asyncio import Redis

from app.core.metrics import BROADCAST_ERRORS, WS_CONNECTIONS
from app.schemas import AuctionOut, BidOut

if TYPE_CHECKING:
    from app.services.bidding import BidResult

logger = logging.getLogger(__name__)

FEED_CHANNEL = "feed"
_REDIS_PREFIX = "bikeauction:"
_SEND_TIMEOUT_SECONDS = 5


def auction_channel(auction_id: int) -> str:
    return f"auction:{auction_id}"


class ConnectionHub:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        await websocket.accept()
        self._channels[channel].add(websocket)
        WS_CONNECTIONS.inc()

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        sockets = self._channels.get(channel)
        if sockets and websocket in sockets:
            sockets.discard(websocket)
            WS_CONNECTIONS.dec()
            if not sockets:
                del self._channels[channel]

    def count(self, channel: str) -> int:
        return len(self._channels.get(channel, ()))

    async def deliver(self, channel: str, message: str) -> None:
        sockets = list(self._channels.get(channel, ()))
        if not sockets:
            return

        async def send(ws: WebSocket) -> WebSocket | None:
            try:
                # A slow or dead client must not hold up everyone else.
                await asyncio.wait_for(ws.send_text(message), _SEND_TIMEOUT_SECONDS)
                return None
            except Exception:
                return ws

        failed = await asyncio.gather(*(send(ws) for ws in sockets))
        for ws in failed:
            if ws is not None:
                self.disconnect(ws, channel)


class Broker(Protocol):
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def publish(self, channel: str, event: dict[str, Any]) -> None: ...


class InMemoryBroker:
    def __init__(self, hub: ConnectionHub) -> None:
        self.hub = hub

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def publish(self, channel: str, event: dict[str, Any]) -> None:
        await self.hub.deliver(channel, json.dumps(event, default=str))


class RedisBroker:
    def __init__(self, hub: ConnectionHub, redis: Redis) -> None:
        self.hub = hub
        self.redis = redis
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._listen(), name="redis-broker")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def publish(self, channel: str, event: dict[str, Any]) -> None:
        await self.redis.publish(_REDIS_PREFIX + channel, json.dumps(event, default=str))

    async def _listen(self) -> None:
        backoff = 1.0
        while True:
            try:
                async with self.redis.pubsub() as pubsub:
                    await pubsub.psubscribe(_REDIS_PREFIX + "*")
                    logger.info("redis_broker_subscribed")
                    backoff = 1.0
                    async for message in pubsub.listen():
                        if message.get("type") != "pmessage":
                            continue
                        channel = message["channel"]
                        if isinstance(channel, bytes):
                            channel = channel.decode()
                        data = message["data"]
                        if isinstance(data, bytes):
                            data = data.decode()
                        await self.hub.deliver(channel.removeprefix(_REDIS_PREFIX), data)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("redis_broker_disconnected", extra={"retry_in_s": backoff}, exc_info=True)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)


# ---------- event builders ----------


def _now() -> str:
    return datetime.now(UTC).isoformat()


def bid_placed_event(
    bid: BidOut, auction: AuctionOut, *, previous_leader_id: int | None, extended: bool
) -> dict[str, Any]:
    return {
        "type": "bid.placed",
        "server_time": _now(),
        "bid": bid.model_dump(mode="json"),
        "auction": auction.model_dump(mode="json"),
        "previous_leader_id": previous_leader_id,
        "extended": extended,
    }


def auction_updated_event(auction: AuctionOut, reason: str) -> dict[str, Any]:
    return {
        "type": "auction.updated",
        "reason": reason,
        "server_time": _now(),
        "auction": auction.model_dump(mode="json"),
    }


async def publish_safely(broker: Broker, channel: str, event: dict[str, Any]) -> None:
    """The database is the source of truth; a failed broadcast is logged, never raised."""
    try:
        await broker.publish(channel, event)
    except Exception:
        BROADCAST_ERRORS.inc()
        logger.exception("broadcast_failed", extra={"channel": channel, "event_type": event.get("type")})


async def broadcast_auction(broker: Broker, auction: AuctionOut, reason: str) -> None:
    event = auction_updated_event(auction, reason)
    await publish_safely(broker, auction_channel(auction.id), event)
    await publish_safely(broker, FEED_CHANNEL, event)


async def announce_bid(broker: Broker, result: "BidResult") -> tuple[BidOut, AuctionOut]:
    """Push an accepted bid to the auction's room and a price update to the listing feed."""
    bid = BidOut.from_model(result.bid)
    auction = AuctionOut.from_model(result.auction)
    await publish_safely(
        broker,
        auction_channel(auction.id),
        bid_placed_event(
            bid, auction, previous_leader_id=result.previous_leader_id, extended=result.extended
        ),
    )
    await publish_safely(
        broker, FEED_CHANNEL, auction_updated_event(auction, "extended" if result.extended else "bid")
    )
    return bid, auction
