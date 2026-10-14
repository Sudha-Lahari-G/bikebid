from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.errors import UnauthorizedError

_password_hash = PasswordHash.recommended()  # Argon2id

# Verified against when the email is unknown, so login timing doesn't reveal which emails exist.
_DUMMY_HASH = _password_hash.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _password_hash.verify(password, _DUMMY_HASH)
        return False
    return _password_hash.verify(password, password_hash)


def create_access_token(user_id: int, role: str) -> tuple[str, int]:
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    claims = {"sub": str(user_id), "role": role, "iat": now, "exp": now + ttl}
    token = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> int:
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp"]},
        )
        return int(claims["sub"])
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError("Session expired, please sign in again", code="TOKEN_EXPIRED") from exc
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise UnauthorizedError("Invalid authentication token", code="INVALID_TOKEN") from exc
