import asyncio
import logging
import time
from typing import Protocol

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class RateLimiter(Protocol):
    async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Count one hit for `key`; return False if the limit for the current window is exceeded."""
        ...


class InMemoryRateLimiter:
    """Fixed-window counter. Per-process only — fine for a single instance or as a fallback."""

    def __init__(self) -> None:
        self._windows: dict[str, tuple[int, int]] = {}
        self._lock = asyncio.Lock()

    async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        window = int(time.time() // window_seconds)
        async with self._lock:
            start, count = self._windows.get(key, (window, 0))
            if start != window:
                start, count = window, 0
            count += 1
            self._windows[key] = (start, count)
            if len(self._windows) > 50_000:  # crude bound on memory
                self._windows = {k: v for k, v in self._windows.items() if v[0] == window}
            return count <= limit


class RedisRateLimiter:
    """Fixed-window counter shared by all API instances."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        window = int(time.time() // window_seconds)
        redis_key = f"ratelimit:{key}:{window}"
        try:
            pipe = self._redis.pipeline()
            pipe.incr(redis_key)
            pipe.expire(redis_key, window_seconds + 1)
            count, _ = await pipe.execute()
        except Exception:
            # Fail open: a Redis outage must not take bidding down with it.
            logger.warning("rate_limiter_unavailable", exc_info=True)
            return True
        return int(count) <= limit
