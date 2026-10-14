from prometheus_client import Counter, Gauge, Histogram

HTTP_REQUESTS = Counter(
    "http_requests_total", "HTTP requests handled", ["method", "route", "status"]
)
HTTP_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)
BIDS = Counter("bids_total", "Bid attempts by outcome", ["outcome"])
WS_CONNECTIONS = Gauge("websocket_connections", "Open WebSocket connections on this instance")
AUCTION_TRANSITIONS = Counter(
    "auction_transitions_total", "Auction status transitions", ["to_status"]
)
SCHEDULER_TICK = Histogram("scheduler_tick_seconds", "Duration of one lifecycle scheduler tick")
SCHEDULER_ERRORS = Counter("scheduler_errors_total", "Lifecycle scheduler tick failures")
BROADCAST_ERRORS = Counter("broadcast_errors_total", "Failures publishing realtime events")
