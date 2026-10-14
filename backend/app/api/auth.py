import logging

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, SessionDep, rate_limit
from app.core.security import create_access_token
from app.models import User
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.services import users as user_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_auth_limit = Depends(rate_limit("auth", lambda s: s.rate_limit_auth_per_minute))


def _token_response(user: User) -> TokenOut:
    token, expires_in = create_access_token(user.id, user.role.value)
    return TokenOut(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_auth_limit],
    summary="Create an account and sign in",
)
async def register(body: RegisterIn, session: SessionDep) -> TokenOut:
    user = await user_service.register(
        session, email=body.email, full_name=body.full_name, password=body.password
    )
    logger.info("user_registered", extra={"user_id": user.id})
    return _token_response(user)


@router.post("/login", response_model=TokenOut, dependencies=[_auth_limit], summary="Sign in")
async def login(body: LoginIn, session: SessionDep) -> TokenOut:
    user = await user_service.authenticate(session, email=body.email, password=body.password)
    logger.info("user_logged_in", extra={"user_id": user.id})
    return _token_response(user)


@router.get("/me", response_model=UserOut, summary="The signed-in user")
async def me(user: CurrentUser) -> User:
    return user
