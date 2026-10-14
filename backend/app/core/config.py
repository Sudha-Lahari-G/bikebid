from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT_SECRET = "dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (and backend/.env locally)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["local", "test", "production"] = "local"
    database_url: str
    redis_url: str | None = None

    jwt_secret: str = _INSECURE_DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 120

    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173"

    log_level: str = "INFO"
    log_json: bool = True

    # Anti-sniping: a bid placed within `window` seconds of the end pushes the
    # end out so that at least `extension` seconds remain.
    anti_snipe_window_seconds: int = 120
    anti_snipe_extension_seconds: int = 120

    scheduler_interval_seconds: float = 1.0
    scheduler_enabled: bool = True

    rate_limit_bids_per_minute: int = 30
    rate_limit_auth_per_minute: int = 10

    # Optional bootstrap admin, created on startup if it does not exist.
    admin_email: str | None = None
    admin_password: str | None = None

    # Keeps the public demo alive by re-listing auctions from a catalog.
    demo_mode: bool = False
    demo_min_active_auctions: int = 6
    # A public "try it" buyer account shown on the login page of the demo site.
    demo_user_email: str = "demo@bikebid.dev"
    demo_user_password: str | None = None

    # If set, /metrics requires `Authorization: Bearer <token>`.
    metrics_token: str | None = None

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, value: str) -> str:
        # Hosted providers hand out plain postgres:// URLs; SQLAlchemy needs the driver name.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> "Settings":
        if self.environment == "production" and (
            self.jwt_secret == _INSECURE_DEFAULT_SECRET or len(self.jwt_secret) < 32
        ):
            raise ValueError("JWT_SECRET must be set to a random value of at least 32 characters")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
