import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import request_id_ctx
from app.core.metrics import HTTP_LATENCY, HTTP_REQUESTS

logger = logging.getLogger("app.request")

_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_QUIET_ROUTES = {"/metrics", "/health/live", "/health/ready"}

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}


def _route_template(scope: dict) -> str:
    # Newer FastAPI keeps the full, prefixed template here; scope["route"].path
    # is only the path relative to the included router.
    context = scope.get("fastapi", {}).get("effective_route_context")
    if getattr(context, "path", None):
        return context.path
    return getattr(scope.get("route"), "path", "unmatched")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns a request id, records metrics, logs one line per request, adds security headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            for name, value in _SECURITY_HEADERS.items():
                response.headers.setdefault(name, value)
            return response
        finally:
            elapsed = time.perf_counter() - started
            # Label by route template (/auctions/{auction_id}), not raw path, to bound cardinality.
            route_path = _route_template(request.scope)
            HTTP_REQUESTS.labels(request.method, route_path, str(status)).inc()
            HTTP_LATENCY.labels(request.method, route_path).observe(elapsed)
            if route_path not in _QUIET_ROUTES:
                logger.info(
                    "request",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "status": status,
                        "duration_ms": round(elapsed * 1000, 2),
                    },
                )
            request_id_ctx.reset(token)
