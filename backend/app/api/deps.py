from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import ForbiddenError, RateLimitedError, UnauthorizedError
from app.core.ratelimit import RateLimiter
from app.core.security import decode_access_token
from app.db import get_session
from app.models import User, UserRole
from app.realtime import Broker

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_bearer = HTTPBearer(auto_error=False, description="JWT from /api/v1/auth/login")


def get_broker(request: Request) -> Broker:
    return request.app.state.broker


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


BrokerDep = Annotated[Broker, Depends(get_broker)]


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise UnauthorizedError("Please sign in to continue", code="NOT_AUTHENTICATED")
    user_id = decode_access_token(credentials.credentials)
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError("Account not found or disabled", code="INVALID_TOKEN")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != UserRole.ADMIN:
        raise ForbiddenError("Administrator access required", code="ADMIN_ONLY")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers, so request.client is the real client behind the load balancer.
    return request.client.host if request.client else "unknown"


def rate_limit(
    scope: str, per_minute: Callable[[Settings], int], *, by_user: bool = False
) -> Callable[..., Awaitable[None]]:
    """Dependency factory: fixed-window limit per user (if authenticated) or per IP."""

    async def dependency(
        request: Request,
        settings: SettingsDep,
        limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
    ) -> None:
        identity = client_ip(request)
        if by_user:
            user = await _optional_user_id(request)
            identity = f"user:{user}" if user else identity
        if not await limiter.hit(f"{scope}:{identity}", per_minute(settings), 60):
            raise RateLimitedError("Too many requests — please slow down", code="RATE_LIMITED")

    return dependency


async def _optional_user_id(request: Request) -> int | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        return decode_access_token(header[7:])
    except UnauthorizedError:
        return None
