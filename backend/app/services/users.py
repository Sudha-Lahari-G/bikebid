from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, UnauthorizedError
from app.core.security import hash_password, verify_password
from app.models import User, UserRole


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def get_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == normalize_email(email)))


async def register(
    session: AsyncSession,
    *,
    email: str,
    full_name: str,
    password: str,
    role: UserRole = UserRole.USER,
) -> User:
    user = User(
        email=normalize_email(email),
        full_name=full_name.strip(),
        password_hash=hash_password(password),
        role=role,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        # Unique index on email decides the race between two concurrent sign-ups.
        await session.rollback()
        raise ConflictError("An account with this email already exists", code="EMAIL_TAKEN") from exc
    await session.refresh(user)
    return user


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    user = await get_by_email(session, email)
    # Same error for "no such user" and "wrong password" — don't leak which emails exist.
    if not verify_password(password, user.password_hash if user else None) or user is None:
        raise UnauthorizedError("Incorrect email or password", code="INVALID_CREDENTIALS")
    if not user.is_active:
        raise UnauthorizedError("This account has been disabled", code="ACCOUNT_DISABLED")
    return user


async def ensure_user(
    session: AsyncSession, *, email: str, full_name: str, password: str, role: UserRole
) -> User:
    """Idempotent: create the user if missing, otherwise return the existing one."""
    existing = await get_by_email(session, email)
    if existing:
        return existing
    try:
        return await register(session, email=email, full_name=full_name, password=password, role=role)
    except ConflictError:
        # Another instance created it between our check and insert.
        user = await get_by_email(session, email)
        assert user is not None
        return user
