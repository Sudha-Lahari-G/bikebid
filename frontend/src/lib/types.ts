export type Role = "user" | "admin";
export type AuctionStatus = "scheduled" | "live" | "ended" | "cancelled";
export type Condition = "excellent" | "good" | "fair" | "project";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

export interface PublicUser {
  id: number;
  display_name: string;
}

export interface Motorcycle {
  id: number;
  make: string;
  model: string;
  year: number;
  mileage_km: number;
  engine_cc: number;
  condition: Condition;
  color: string | null;
  location: string;
  description: string;
  image_url: string | null;
}

export interface Auction {
  id: number;
  title: string;
  status: AuctionStatus;
  starting_price: number;
  current_price: number;
  min_increment: number;
  next_min_bid: number;
  bid_count: number;
  has_reserve: boolean;
  reserve_met: boolean;
  leading_bidder: PublicUser | null;
  winner: PublicUser | null;
  starts_at: string;
  ends_at: string;
  extension_count: number;
  ended_at: string | null;
  motorcycle: Motorcycle;
}

export interface AdminAuction extends Auction {
  reserve_price: number | null;
  created_at: string;
}

export interface Bid {
  id: number;
  auction_id: number;
  amount: number;
  created_at: string;
  bidder: PublicUser;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export interface MyAuction {
  auction: Auction;
  my_highest_bid: number;
  is_leading: boolean;
  is_winner: boolean;
}

export interface AdminStats {
  users: number;
  auctions_by_status: Record<AuctionStatus, number>;
  total_bids: number;
  bids_last_hour: number;
  gross_sales: number;
}

export interface MotorcycleInput {
  make: string;
  model: string;
  year: number;
  mileage_km: number;
  engine_cc: number;
  condition: Condition;
  color: string | null;
  location: string;
  description: string;
  image_url: string | null;
}

export interface AuctionInput {
  title: string;
  motorcycle: MotorcycleInput;
  starting_price: number;
  reserve_price: number | null;
  min_increment: number;
  starts_at: string;
  ends_at: string;
}

export type LiveEvent =
  | { type: "hello" | "pong"; server_time: string }
  | {
      type: "bid.placed";
      server_time: string;
      bid: Bid;
      auction: Auction;
      previous_leader_id: number | null;
      extended: boolean;
    }
  | {
      type: "auction.updated";
      server_time: string;
      reason: "created" | "started" | "ended" | "cancelled" | "edited" | "bid" | "extended";
      auction: Auction;
    };
