import type {
  AdminAuction,
  AdminStats,
  Auction,
  AuctionInput,
  AuctionStatus,
  Bid,
  MyAuction,
  Page,
  TokenResponse,
  User,
} from "./types";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws");

const TOKEN_KEY = "bikebid.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable (private mode) — session-only login */
    }
  },
};

type Listener = (error: ApiError) => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

type Query = Record<string, string | number | undefined | null | string[]>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = payload?.error ?? {};
    const error = new ApiError(
      response.status,
      err.code ?? "HTTP_ERROR",
      err.message ?? `Request failed (${response.status})`,
      err.details ?? {},
    );
    if (response.status === 401 && token) unauthorizedListeners.forEach((l) => l(error));
    throw error;
  }
  return payload as T;
}

export interface AuctionQuery {
  status?: AuctionStatus[];
  q?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  serverTime: () => request<{ server_time: string }>("GET", "/api/v1/time"),

  register: (body: { email: string; full_name: string; password: string }) =>
    request<TokenResponse>("POST", "/api/v1/auth/register", { body }),
  login: (body: { email: string; password: string }) => request<TokenResponse>("POST", "/api/v1/auth/login", { body }),
  me: () => request<User>("GET", "/api/v1/auth/me"),

  auctions: (q: AuctionQuery) => request<Page<Auction>>("GET", "/api/v1/auctions", { query: { ...q } }),
  auction: (id: number) => request<Auction>("GET", `/api/v1/auctions/${id}`),
  bids: (id: number, limit = 30) => request<Page<Bid>>("GET", `/api/v1/auctions/${id}/bids`, { query: { limit } }),
  placeBid: (id: number, amount: number) =>
    request<{ bid: Bid; auction: Auction; extended: boolean }>("POST", `/api/v1/auctions/${id}/bids`, {
      body: { amount },
    }),
  myAuctions: () => request<MyAuction[]>("GET", "/api/v1/me/auctions"),

  admin: {
    stats: () => request<AdminStats>("GET", "/api/v1/admin/stats"),
    auctions: (q: AuctionQuery) => request<Page<AdminAuction>>("GET", "/api/v1/admin/auctions", { query: { ...q } }),
    auction: (id: number) => request<AdminAuction>("GET", `/api/v1/admin/auctions/${id}`),
    create: (body: AuctionInput) => request<AdminAuction>("POST", "/api/v1/admin/auctions", { body }),
    update: (id: number, body: Partial<AuctionInput>) =>
      request<AdminAuction>("PATCH", `/api/v1/admin/auctions/${id}`, { body }),
    cancel: (id: number, reason: string) =>
      request<AdminAuction>("POST", `/api/v1/admin/auctions/${id}/cancel`, { body: { reason } }),
  },
};

const FRIENDLY: Record<string, string> = {
  BID_TOO_LOW: "Someone bid first — the minimum has gone up.",
  ALREADY_LEADING: "You already hold the top bid.",
  AUCTION_NOT_LIVE: "This auction isn't accepting bids right now.",
  ADMIN_CANNOT_BID: "Admin accounts can't bid.",
  RATE_LIMITED: "Slow down a little — too many attempts.",
  INVALID_CREDENTIALS: "That email and password don't match.",
  EMAIL_TAKEN: "An account with that email already exists.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return FRIENDLY[error.code] ?? error.message;
  return "Something went wrong. Please try again.";
}
