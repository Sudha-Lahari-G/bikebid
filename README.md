# BikeBid — Live Motorcycle Auctions

A production-grade, real-time auction platform for pre-owned motorcycles. Registered users bid in live auctions that run simultaneously; every accepted bid is pushed to every watcher instantly, auctions open and close themselves on schedule, and late bids extend the clock so nobody wins by sniping.

**Live demo:** _frontend URL_ · **API docs:** _backend URL_/docs
_(The free API host sleeps when idle — the first request can take ~30–60 s to wake it.)_

> Try it without signing up: on the sign-in page click **"Try the demo bidder account"**. Demo mode keeps several auctions live at all times, with a few bot bidders so you can watch prices move and get outbid.

---

## Contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Key design decisions](#key-design-decisions)
5. [Data model](#data-model)
6. [API overview](#api-overview)
7. [Security](#security)
8. [Observability](#observability)
9. [Testing](#testing)
10. [Running locally](#running-locally)
11. [Deploying for free](#deploying-for-free)
12. [Configuration reference](#configuration-reference)
13. [Scalability](#scalability)
14. [Assumptions, trade-offs and future work](#assumptions-trade-offs-and-future-work)
15. [Project structure](#project-structure)

---

## Features

**Buyers**
- Browse live, upcoming and finished auctions; search by make, model or city; sort by ending soonest, price or popularity.
- Real-time auction page: price, bid history and countdown update instantly over WebSockets — no refresh.
- One-tap quick bids (minimum, +2, +5 increments) and a custom amount, with a confirmation step for unusually large jumps.
- Instant **"You've been outbid!"** alerts, anti-sniping notices and a celebration when you win.
- "My bids" dashboard: winning / outbid / won / lost, all updating live.
- Countdowns follow the **server's clock**, not the device's, so a wrong laptop clock can't mislead a bidder.

**Administrators**
- Dashboard with live counts, bids in the last hour, gross sales and user totals.
- Create auctions (go live now or schedule), edit scheduled ones, cancel live or scheduled ones with an audited reason.
- Secret **reserve prices**: visible only to admins; the public sees only "reserve met / not met".
- Live preview of the listing card while filling in the form.

**Platform**
- Lifecycle: `scheduled → live → ended` (or `cancelled`), driven automatically by a background scheduler.
- Concurrency-safe bidding (row-level locking) — tested with simultaneous bids.
- Anti-sniping: a bid in the final 2 minutes extends the auction to 2 minutes from that bid.
- Structured JSON logs, request IDs, Prometheus metrics, liveness/readiness checks.
- Rate limiting on sign-in and bidding; Argon2id password hashing; JWT auth; role-based access.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python 3.12) | Async, typed, automatic OpenAPI docs, first-class WebSockets |
| Database | **PostgreSQL 16** | Transactions and row locks are the backbone of correct bidding |
| ORM / migrations | **SQLAlchemy 2 (async)** + **Alembic** | Typed models; versioned, reviewable schema changes |
| Driver | **Psycopg 3** | Modern async PostgreSQL driver |
| Realtime fan-out | **WebSockets + Redis pub/sub** (optional) | Broadcast across many API instances; falls back to in-memory |
| Validation | **Pydantic v2** | Request/response contracts, settings |
| Auth | **JWT (PyJWT)** + **Argon2id (pwdlib)** | Stateless auth; memory-hard password hashing |
| Frontend | **React 18 + TypeScript + Vite** | Fast, typed SPA |
| Styling | **Tailwind CSS** | Consistent design system, small CSS bundle |
| Server state | **TanStack Query** | Caching, retries, and a single place to merge live updates |
| Observability | **prometheus-client**, JSON logging | Standard, vendor-neutral |
| Testing | **pytest + HTTPX**, **Vitest** | Real PostgreSQL in tests; unit tests for client logic |
| Local env | **Docker Compose** | One command for Postgres, Redis and the API |
| CI | **GitHub Actions** | Lint, migrations up/down, tests, builds on every push |
| Hosting (free) | **Vercel** (UI), **Render** (API), **Neon** (Postgres), **Upstash** (Redis) | $0 total |

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI[React SPA]
    end

    UI -- "REST /api/v1 (JWT)" --> API
    UI -- "WebSocket /ws/feed, /ws/auctions/{id}" --> API

    subgraph API["FastAPI instance (×N)"]
        R[Routers] --> S[Services<br/>bidding · auctions · users]
        SCH[Lifecycle scheduler<br/>1s tick] --> S
        S --> B[Broker]
        B --> HUB[Connection hub<br/>local sockets]
    end

    S -- "transactions, SELECT … FOR UPDATE" --> PG[(PostgreSQL)]
    B -- "PUBLISH / PSUBSCRIBE" --> RD[(Redis pub/sub)]
    RD -- "events from any instance" --> B
    API -- "/metrics" --> PROM[Prometheus / scraper]
```

**The life of a bid:**

```mermaid
sequenceDiagram
    participant A as Bidder A (browser)
    participant API as API instance 1
    participant DB as PostgreSQL
    participant R as Redis
    participant API2 as API instance 2
    participant B as Watcher B (browser)

    A->>API: POST /auctions/42/bids {amount}
    API->>DB: BEGIN; SELECT auction 42 FOR UPDATE
    Note over API,DB: Concurrent bids on auction 42 wait here.<br/>Other auctions are unaffected.
    API->>API: validate: live? not past end? ≥ next minimum? not already leading?
    API->>DB: INSERT bid; UPDATE price, leader, ends_at (anti-snipe); COMMIT
    API-->>A: 201 Created (new state)
    API->>R: PUBLISH auction:42 bid.placed
    R->>API2: message
    API2->>B: WebSocket push → price flashes, history updates
```

The database is the single source of truth. Broadcasting happens **after** commit and is best-effort: if a push is lost, clients re-fetch on reconnect, so the UI always converges to the committed state.

## Key design decisions

### 1. Correct bidding under concurrency
Every bid runs in one transaction that locks the auction row with `SELECT … FOR UPDATE` (see [`services/bidding.py`](backend/app/services/bidding.py)). Concurrent bids on the same auction are serialised and each is validated against the price the previous one left behind. Bids on *different* auctions never block each other.

As a second line of defence, the database has a `UNIQUE (auction_id, amount)` constraint and a `CHECK` that the price never drops below the start. Even a bug in application code can't record two winning bids at the same amount.

The test suite fires 15 identical bids at once and asserts that **exactly one** is accepted. It also fires 15 rising bids and checks that the auction's stored price and bid count match the bid table.

### 2. Lifecycle without a separate worker
Free hosting has no background workers, so the scheduler runs inside each API process and ticks every second. Each transition is a single guarded statement:

```sql
UPDATE auctions SET status = 'ended', winner_id = CASE WHEN reserve met THEN leading_bidder_id END
WHERE status = 'live' AND ends_at <= now()
RETURNING id;
```

This is **idempotent** and safe with many instances: each row changes exactly once, and only the instance that changed it broadcasts the change. It also interacts correctly with bidding. The `UPDATE` waits for a bid's row lock, and PostgreSQL then re-checks the `WHERE` against the committed row. So if a last-second bid pushed `ends_at` forward, the auction correctly stays open.

If the API was asleep (free tier), the first tick after waking catches up and closes everything that's overdue. The bid endpoint also checks `now < ends_at` itself, so it never relies on the scheduler being on time.

### 3. Anti-sniping
A bid placed with less than 2 minutes left moves the end to 2 minutes after that bid. The window and extension are configurable. The UI shows an "Extended ×N" badge and notifies watchers.

### 4. Real-time fan-out that scales out
Browsers connect to `/ws/auctions/{id}` (one auction) or `/ws/feed` (all price/status changes, used by the listing pages). Each API instance tracks its own sockets in a `ConnectionHub`. When `REDIS_URL` is set, events go through Redis pub/sub so a bid accepted on instance A reaches viewers connected to instance B. Without Redis, an in-memory broker keeps a single instance fully functional.

Slow or dead sockets are dropped after a send timeout, so they can't stall a broadcast. Clients reconnect with exponential backoff plus jitter, and re-fetch state after reconnecting.

### 5. Server-authoritative time
The client estimates its clock offset NTP-style from `GET /api/v1/time` (using the round-trip midpoint). All countdowns tick on `Date.now() + offset` from one shared 1-second timer. The server alone decides whether a bid is in time.

### 6. Money as integers
Prices are whole rupees in `BIGINT` columns. That means no floating-point rounding, exact comparisons, and simple JSON.

### 7. Privacy by default
Other users see only a display name like "Ravi K.", never an email address. Reserve prices are never sent to non-admins.

## Data model

```mermaid
erDiagram
    USERS ||--o{ BIDS : places
    USERS ||--o{ AUCTIONS : "creates (admin)"
    MOTORCYCLES ||--|| AUCTIONS : "is sold in"
    AUCTIONS ||--o{ BIDS : receives

    USERS {
        int id PK
        string email UK
        string full_name
        string password_hash "Argon2id"
        enum role "user | admin"
        bool is_active
    }
    MOTORCYCLES {
        int id PK
        string make
        string model
        int year
        int mileage_km
        int engine_cc
        enum condition
        string location
        text description
        string image_url "optional"
    }
    AUCTIONS {
        int id PK
        int motorcycle_id FK,UK
        enum status "scheduled|live|ended|cancelled"
        bigint starting_price
        bigint reserve_price "secret, nullable"
        bigint min_increment
        bigint current_price "denormalised"
        int bid_count "denormalised"
        int leading_bidder_id FK
        int winner_id FK
        timestamptz starts_at
        timestamptz ends_at "moves on anti-snipe"
        int extension_count
    }
    BIDS {
        int id PK
        int auction_id FK
        int bidder_id FK
        bigint amount "UNIQUE per auction"
        timestamptz created_at
    }
```

`current_price`, `bid_count` and `leading_bidder_id` are denormalised onto the auction, so listing pages never aggregate the bid table. They're only ever updated inside the locked bid transaction, which keeps them consistent; a test verifies this. Composite indexes on `(status, starts_at)` and `(status, ends_at)` serve the scheduler's once-a-second scans.

## API overview

Interactive docs: **`/docs`** (Swagger UI) and `/redoc`. All errors share one shape:

```json
{ "error": { "code": "BID_TOO_LOW", "message": "Bid must be at least ₹1,01,000", "details": { "min_bid": 101000 } } }
```

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Create account, returns JWT |
| POST | `/api/v1/auth/login` | — | Sign in, returns JWT |
| GET | `/api/v1/auth/me` | user | Current user |
| GET | `/api/v1/auctions?status=&q=&sort=&limit=&offset=` | — | Browse/search (paginated) |
| GET | `/api/v1/auctions/{id}` | — | Auction details |
| GET | `/api/v1/auctions/{id}/bids` | — | Bid history, highest first |
| POST | `/api/v1/auctions/{id}/bids` | user | Place a bid (rate-limited) |
| GET | `/api/v1/me/auctions` | user | Auctions I've bid on, with my status |
| GET | `/api/v1/time` | — | Server clock for countdown sync |
| GET | `/api/v1/admin/stats` | admin | Dashboard numbers |
| GET | `/api/v1/admin/auctions` · `/{id}` | admin | Listings including reserve |
| POST | `/api/v1/admin/auctions` | admin | Create auction |
| PATCH | `/api/v1/admin/auctions/{id}` | admin | Edit (scheduled only) |
| POST | `/api/v1/admin/auctions/{id}/cancel` | admin | Cancel with reason |
| WS | `/ws/auctions/{id}` | — | `bid.placed`, `auction.updated` for one auction |
| WS | `/ws/feed` | — | `auction.updated` for all auctions |
| GET | `/health/live` · `/health/ready` | — | Liveness · readiness (DB, Redis, scheduler) |
| GET | `/metrics` | token | Prometheus metrics |

Bid rejection codes: `BID_TOO_LOW`, `AUCTION_NOT_LIVE`, `ALREADY_LEADING`, `ADMIN_CANNOT_BID`, `RATE_LIMITED`.

## Security

- **Passwords:** Argon2id via `pwdlib`. Login compares against a dummy hash when the email is unknown, so response timing and error messages don't reveal which emails are registered.
- **Auth:** short-lived HS256 JWTs. The production config refuses to start with a default or short `JWT_SECRET`.
- **Authorisation:** role checks are FastAPI dependencies (`AdminUser`, `CurrentUser`). Admins can't bid, which avoids conflicts of interest.
- **Input validation:** Pydantic on every request: bounded strings and prices, timezone-aware datetimes, cross-field rules (reserve ≥ start, end after start, duration limits). The database repeats the critical rules as `CHECK` constraints.
- **Abuse protection:** fixed-window rate limits per user (bids) and per IP (auth). These are shared across instances through Redis, and fail open if Redis is down so bidding stays available.
- **Injection:** SQLAlchemy parameterised queries throughout. User search terms have `LIKE` wildcards escaped.
- **Transport and browser:** strict CORS allow-list; `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers on API and frontend.
- **Secrets:** read from environment variables only; `.env` is git-ignored and `.env.example` documents every variable. The `/metrics` endpoint can require a bearer token.
- **Containers:** the production image runs as a non-root user.

## Observability

- **Structured logs.** Each line is one JSON object with a `request_id`, ready for Loki, Datadog or CloudWatch. Each request is logged once with method, path, status and duration. Domain events are logged as well: `bid_accepted`, `bid_rejected` (with the reason), `auction_started`, `auction_ended` (with winner and price), `auction_cancelled` (with the admin and reason), plus scheduler and broker failures.
- **Request IDs.** An incoming `X-Request-ID` header is honoured, or one is generated. It's returned in the response and attached to every log line for that request.
- **Metrics** at `/metrics` (Prometheus format):
  - `http_requests_total{method,route,status}` and `http_request_duration_seconds` (labelled by route template, so labels stay bounded)
  - `bids_total{outcome}`: accepted, plus rejections by reason
  - `websocket_connections`: open sockets on this instance
  - `auction_transitions_total{to_status}`, `scheduler_tick_seconds`, `scheduler_errors_total`
  - `broadcast_errors_total`
- **Health checks.** `/health/live` returns OK if the process is up (used by Render). `/health/ready` checks database and Redis connectivity and whether the scheduler has ticked recently, and returns 503 when degraded.

## Testing

```bash
docker compose up -d db redis
docker compose run --rm api pytest -q       # 42 backend tests against real PostgreSQL
cd frontend && npm test                     # client-side unit tests
```

The backend tests run against **real PostgreSQL**, not SQLite, because row locks and constraints are exactly the behaviour being tested.

| Suite | What it proves |
|---|---|
| `test_concurrency.py` | 15 simultaneous identical bids → exactly 1 accepted. Rising concurrent bids leave price, count and bid table consistent. Different auctions don't block each other. |
| `test_bidding.py` | Minimum bid and increments, can't outbid yourself, admins can't bid, closed or scheduled auctions reject bids, a bid after the end time is rejected even if the scheduler is late, anti-sniping extends only late bids, bid history and "my auctions". |
| `test_lifecycle.py` | Scheduled → live → ended transitions, reserve met → winner, reserve not met → no winner, no bids → unsold, an extended auction isn't closed at its old end time, cancelled auctions never restart, ticks are idempotent. |
| `test_auctions.py` | Admin-only creation, schedule and price validation, reserve hidden from the public, search (including literal `%`), pagination, edit rules, cancellation, stats. |
| `test_auth.py` | Registration, case-insensitive unique emails, weak passwords, identical errors for unknown email vs wrong password, token validation, rate limiting. |
| `test_realtime_and_ops.py` | Accepted bids are pushed to the auction room and the feed; rejected bids aren't; dead sockets are dropped without affecting others; health, request IDs, metrics, error shape. |

CI (`.github/workflows/ci.yml`) runs on every push:
- **Backend:** lint, migrations `upgrade → downgrade → upgrade` on an empty database, then the tests.
- **Frontend:** type-check, unit tests, production build.
- **Docker:** builds the production image.

## Running locally

**Prerequisites:** Docker Desktop and Node.js 20+.

```bash
# 1. Database, Redis and the API (migrations run automatically; demo mode is on)
docker compose up -d --build
#    API + Swagger: http://localhost:8000/docs

# 2. Load the realistic dataset: 78 auctions, ~380 bids, 14 users
docker compose exec api python -m app.seed --reset

# 3. Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev
#    http://localhost:5173
```

Local accounts (all with password `BikeBid@123`):

| Role | Email |
|---|---|
| Admin | `admin@bikebid.dev` |
| Demo bidder | `demo@bikebid.dev` |
| Seeded bidders | `aarav@demo.bikebid.dev`, `diya@demo.bikebid.dev`, … |

To check that real-time updates work, open the same live auction in two browser windows as two different users, bid in one, and watch the other update.

Alternatively, `docker compose --profile web up --build` also serves the production frontend build through nginx on port 5173.

## Deploying for free

Everything below fits in free tiers ($0). Push the repository to GitHub first.

**1. Database: [Neon](https://neon.tech)**
1. Create a project in a region near your users (e.g. Singapore).
2. Copy the connection string. Use the **direct** one, not the `-pooler` host. It looks like `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`. The app converts the scheme for SQLAlchemy automatically.

**2. Redis (optional): [Upstash](https://upstash.com)**
1. Create a Redis database and copy the `rediss://…` URL.

**3. API: [Render](https://render.com)**
1. Go to **New → Blueprint** and choose the repo. Render reads [`render.yaml`](render.yaml), which defines a Docker web service on the free plan.
2. Fill in the prompted values:
   - `DATABASE_URL`: from Neon
   - `REDIS_URL`: from Upstash, or leave empty
   - `CORS_ORIGINS`: your Vercel URL (you can fill this in after step 4)
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your admin login
   - `DEMO_USER_PASSWORD`: e.g. `BikeBid@123`
   - `JWT_SECRET` and `METRICS_TOKEN` are generated for you.
3. Deploy. Migrations run on start. Then load the dataset once from your own machine, pointing the seed script at Neon:
   ```bash
   docker compose run --rm --no-deps \
     -e DATABASE_URL="<your Neon URL>" \
     -e ADMIN_EMAIL="<same as on Render>" -e ADMIN_PASSWORD="<same as on Render>" \
     -e DEMO_USER_PASSWORD="<same as on Render>" \
     api python -m app.seed
   ```
   Pass the same admin and demo values as on Render. Otherwise the seed falls back to the local defaults and creates an admin with a publicly known password.
   This step is optional: with `DEMO_MODE=true` the site lists auctions by itself. The seed adds past results and bid history.
4. Check `https://<service>.onrender.com/health/ready`.

**4. Frontend: [Vercel](https://vercel.com)**
1. **Add New → Project**, import the repo, and set **Root Directory** to `frontend`. The framework is detected as Vite.
2. Set these environment variables:
   - `VITE_API_URL=https://<service>.onrender.com`
   - `VITE_DEMO_EMAIL=demo@bikebid.dev`
   - `VITE_DEMO_PASSWORD`: the same value as `DEMO_USER_PASSWORD` on Render
3. Deploy, then put the Vercel URL into `CORS_ORIGINS` on Render. Render redeploys automatically.

> **Free-tier note:** Render's free web services sleep after ~15 minutes without traffic and take ~30–60 s to wake. Nothing is lost while asleep: the first scheduler tick after waking closes any overdue auctions. To keep the demo always warm, point a free uptime monitor (e.g. UptimeRobot or cron-job.org) at `/health/live` every 10 minutes.

## Configuration reference

All settings are environment variables (see [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example)).

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT` | `local` | `production` enforces a strong `JWT_SECRET` |
| `DATABASE_URL` | — | PostgreSQL URL (required) |
| `REDIS_URL` | empty | Enables cross-instance realtime and shared rate limits |
| `JWT_SECRET` | dev value | ≥ 32 random characters in production |
| `ACCESS_TOKEN_TTL_MINUTES` | `120` | Session length |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `LOG_LEVEL` / `LOG_JSON` | `INFO` / `true` | Logging |
| `ANTI_SNIPE_WINDOW_SECONDS` / `ANTI_SNIPE_EXTENSION_SECONDS` | `120` / `120` | Anti-sniping rule |
| `RATE_LIMIT_BIDS_PER_MINUTE` / `RATE_LIMIT_AUTH_PER_MINUTE` | `30` / `10` | Abuse limits |
| `SCHEDULER_INTERVAL_SECONDS` | `1.0` | Lifecycle tick |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | empty | Bootstrap admin created on startup |
| `DEMO_MODE` | `false` | Auto re-list auctions and run bot bidders |
| `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` | `demo@bikebid.dev` / empty | Public demo account |
| `METRICS_TOKEN` | empty | Bearer token required for `/metrics` |
| `VITE_API_URL` | `http://localhost:8000` | Frontend → API base URL |
| `VITE_DEMO_EMAIL` / `VITE_DEMO_PASSWORD` | empty | Shows the "Try the demo" button |

## Scalability

- **Stateless API.** JWT auth and DB-backed state mean API instances can be added behind a load balancer. With Redis configured, WebSocket events and rate limits work across instances.
- **Lock granularity.** Contention is per auction row. Ten thousand auctions receiving bids at once don't contend with each other; only bids on the *same* auction queue up, and that is the semantics an auction needs.
- **Read path.** Listing pages read denormalised columns and use indexed filters; nothing aggregates the bid table per request. Bid history is paginated.
- **Fan-out cost.** Broadcasting is O(watchers of that auction) per bid. The listing feed sends compact snapshots that clients merge into their cache instead of re-fetching.
- **Scheduler.** Each tick is two indexed `UPDATE … RETURNING` statements. Running it on every instance is safe (idempotent); for very large deployments it can move to a dedicated worker using the same code.
- **Next steps at higher scale:** a read replica for browse traffic, PgBouncer in front of PostgreSQL, CDN caching for public listing responses, and Redis Streams or Kafka instead of pub/sub if events must survive disconnects.

## Assumptions, trade-offs and future work

**Assumptions**
- A single currency (INR) in whole rupees, and a single platform that lists bikes, with admins acting for sellers.
- Winning an auction creates an obligation to buy. Payment, inspection and handover happen off-platform.
- Watching auctions is public; bidding requires an account.

**Trade-offs**
- **JWT in localStorage** rather than an httpOnly cookie. The UI (Vercel) and API (Render) are on different domains, where third-party cookies are increasingly blocked. Tokens are short-lived and the app renders no user-supplied HTML. On a shared parent domain, httpOnly `SameSite` cookies with refresh-token rotation would be the next step.
- **Fixed-window rate limiting** is simple and cheap. A sliding window or token bucket is smoother at window edges.
- **Pub/sub is fire-and-forget.** A client that misses an event while reconnecting re-fetches state rather than replaying events.
- **Illustrated bike cards** stand in for photos. Listings accept an image URL, but image upload and storage (S3 or R2) is out of scope.

**Future work:** image uploads; email or push notifications for outbid and won events; proxy (automatic) bidding; watchlists; seller self-service accounts; payments escrow; refresh tokens and account verification; an audit-log table; an OpenTelemetry tracing exporter; and Playwright end-to-end tests.

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── api/            # routers: auth, auctions (+ bids), admin, ops (health, metrics, websockets)
│   │   ├── core/           # config, logging, errors, security, metrics, middleware, rate limiting
│   │   ├── services/       # business logic: bidding, auctions, lifecycle scheduler, users
│   │   ├── models.py       # SQLAlchemy models and constraints
│   │   ├── schemas.py      # Pydantic request/response contracts
│   │   ├── realtime.py     # connection hub, in-memory and Redis brokers, event builders
│   │   ├── catalog.py      # 48 real bike models used by the seed script and demo mode
│   │   ├── seed.py         # realistic dataset generator
│   │   └── main.py         # app factory and lifespan
│   ├── migrations/         # Alembic
│   ├── tests/              # pytest suites (real PostgreSQL)
│   └── Dockerfile          # dev and prod (non-root) targets
├── frontend/
│   └── src/
│       ├── lib/            # API client, auth, live sockets, clock sync, cache merging, formatting
│       ├── components/     # layout, auction card, bike illustration, UI primitives
│       └── pages/          # browse, auction detail, auth, my bids, admin dashboard and form
├── docker-compose.yml
├── render.yaml             # API deploy blueprint
└── .github/workflows/ci.yml
```
