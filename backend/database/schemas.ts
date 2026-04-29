import { ObjectId } from 'mongodb';

// Core auction data from Bring a Trailer
export interface Auction {
  _id?: ObjectId;
  bat_id: string; // BaT's internal auction ID
  url: string; // Full BaT listing URL
  title: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  reserve_status: 'no_reserve' | 'reserve'; // MVP focuses on no_reserve only
  lot_number?: string;
  
  // Auction timing
  start_date: Date;
  end_date: Date;
  is_live: boolean;
  current_bid?: number;
  bid_count?: number;
  
  // Final results (populated after auction closes)
  final_price?: number;
  winning_bidder?: string;
  closed_at?: Date;
  
  // Metadata
  status: 'draft' | 'active' | 'extended' | 'closed' | 'cancelled';
  created_at: Date;
  updated_at: Date;
  created_by: ObjectId; // Admin user who imported this auction
}

// Time-series observations of auction state
export interface AuctionObservation {
  _id?: ObjectId;
  auction_id: ObjectId;
  observed_at: Date;
  current_bid: number;
  bid_count: number;
  time_left_seconds: number;
  is_extended: boolean;
  raw_html_snapshot?: string; // Evidence for dispute resolution
  created_at: Date;
}

// Prediction events tied to real-world auctions
export interface Event {
  _id?: ObjectId;
  title: string;
  description: string;
  auction_id: ObjectId; // Which BaT auction this event is about
  slug: string; // URL-friendly identifier
  
  // Resolution criteria
  resolution_source: 'bat_final_price';
  resolution_value?: number; // Final auction price when resolved
  resolved_at?: Date;
  
  status: 'draft' | 'published' | 'trading' | 'resolved' | 'cancelled';
  created_at: Date;
  updated_at: Date;
  created_by: ObjectId;
}

// Binary or multi-outcome prediction markets
export interface Market {
  _id?: ObjectId;
  event_id: ObjectId;
  title: string;
  description: string;
  slug: string;
  
  // Market configuration
  type: 'threshold' | 'bucket'; // threshold: "Will close >= $X?", bucket: "Which price range?"
  threshold_value?: number; // For threshold markets
  bucket_ranges?: Array<{ min: number; max?: number; label: string }>; // For bucket markets
  
  // Market lifecycle
  trading_starts_at: Date;
  trading_ends_at: Date;
  status: 'draft' | 'published' | 'trading' | 'resolved' | 'cancelled';
  
  created_at: Date;
  updated_at: Date;
  created_by: ObjectId;
}

// Individual outcomes within a market (Yes/No for threshold, each bucket for ranges)
export interface Outcome {
  _id?: ObjectId;
  market_id: ObjectId;
  title: string; // "Yes", "No", "$300K-$400K", etc.
  slug: string;
  sort_order: number;
  
  // Resolution
  is_winning_outcome?: boolean;
  
  created_at: Date;
  updated_at: Date;
}

// User accounts and authentication
export interface User {
  _id?: ObjectId;
  email: string;
  username: string;
  password_hash?: string; // Optional for wallet-only users
  
  // Wallet connection
  primary_wallet_address?: string;
  wallet_nonce?: string; // For signature-based auth
  
  // Profile
  is_admin: boolean;
  is_verified: boolean;
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected';
  
  // Risk management
  position_limit_usd: number;
  is_suspended: boolean;
  suspension_reason?: string;
  
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date;
}

// User wallet connections (can have multiple)
export interface Wallet {
  _id?: ObjectId;
  user_id: ObjectId;
  address: string;
  chain: 'polygon' | 'ethereum'; // Future multi-chain support
  is_primary: boolean;
  created_at: Date;
  last_used_at?: Date;
}

// User balance tracking (offchain ledger)
export interface UserBalance {
  _id?: ObjectId;
  user_id: ObjectId;
  currency: 'USDC'; // MVP uses USDC only
  available_balance: number; // Available for new orders
  locked_balance: number; // Locked in open orders
  total_balance: number; // available + locked
  
  updated_at: Date;
}

// Double-entry ledger for all balance changes
export interface LedgerEntry {
  _id?: ObjectId;
  user_id: ObjectId;
  entry_type: 'deposit' | 'withdrawal' | 'trade' | 'settlement' | 'fee' | 'adjustment';
  amount: number; // Positive for credits, negative for debits
  currency: 'USDC';
  
  // Context
  reference_type?: 'order' | 'trade' | 'market' | 'deposit' | 'withdrawal';
  reference_id?: ObjectId;
  description: string;
  
  // Balances after this entry
  balance_after: number;
  
  created_at: Date;
  created_by?: ObjectId; // Admin user for manual adjustments
}

// Trading orders
export interface Order {
  _id?: ObjectId;
  user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  
  // Order details
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: number; // Price per share in USDC
  quantity: number; // Number of shares
  filled_quantity: number;
  remaining_quantity: number;
  
  // Order management
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired';
  time_in_force: 'GTC' | 'IOC' | 'FOK'; // Good Till Cancel, Immediate Or Cancel, Fill Or Kill
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;
  filled_at?: Date;
  cancelled_at?: Date;
}

// Executed trades (matches between orders)
export interface Trade {
  _id?: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  
  // Order references
  buy_order_id: ObjectId;
  sell_order_id: ObjectId;
  buy_user_id: ObjectId;
  sell_user_id: ObjectId;
  
  // Trade details
  price: number;
  quantity: number;
  total_value: number; // price * quantity
  
  // Fees (future enhancement)
  buy_fee?: number;
  sell_fee?: number;
  
  executed_at: Date;
}

// User positions in markets
export interface Position {
  _id?: ObjectId;
  user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  
  // Position details
  quantity: number; // Can be negative for short positions
  average_price: number;
  total_cost: number;
  unrealized_pnl: number;
  
  // Settlement
  is_settled: boolean;
  settlement_value?: number;
  realized_pnl?: number;
  settled_at?: Date;
  
  created_at: Date;
  updated_at: Date;
}

// Market resolution proposals from oracle service
export interface ResolutionProposal {
  _id?: ObjectId;
  market_id: ObjectId;
  event_id: ObjectId;
  
  // Proposed resolution
  winning_outcome_id?: ObjectId;
  resolution_value: number; // The actual auction close price
  resolution_reasoning: string;
  
  // Evidence
  evidence_url: string; // Link to BaT auction page
  evidence_snapshot: string; // HTML snapshot of final auction state
  proposed_at: Date;
  
  // Admin review
  status: 'pending' | 'approved' | 'rejected' | 'disputed';
  reviewed_by?: ObjectId;
  reviewed_at?: Date;
  review_notes?: string;
  
  created_at: Date;
}

// Admin audit log
export interface AdminAction {
  _id?: ObjectId;
  admin_user_id: ObjectId;
  action_type: string;
  target_type: 'auction' | 'market' | 'user' | 'order' | 'resolution';
  target_id: ObjectId;
  changes: Record<string, any>;
  reason?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

// Risk flags and monitoring
export interface RiskFlag {
  _id?: ObjectId;
  flag_type: 'unusual_volume' | 'position_limit' | 'suspected_manipulation' | 'account_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Context
  user_id?: ObjectId;
  market_id?: ObjectId;
  order_id?: ObjectId;
  
  description: string;
  auto_generated: boolean;
  is_resolved: boolean;
  resolution_notes?: string;
  
  created_at: Date;
  resolved_at?: Date;
  resolved_by?: ObjectId;
}

// Collection names for MongoDB
export const COLLECTIONS = {
  auctions: 'auctions',
  auction_observations: 'auction_observations',
  events: 'events',
  markets: 'markets',
  outcomes: 'outcomes',
  users: 'users',
  wallets: 'wallets',
  user_balances: 'user_balances',
  ledger_entries: 'ledger_entries',
  orders: 'orders',
  trades: 'trades',
  positions: 'positions',
  resolution_proposals: 'resolution_proposals',
  admin_actions: 'admin_actions',
  risk_flags: 'risk_flags'
} as const;