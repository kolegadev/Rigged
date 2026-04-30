import { get_database } from './connection.js';
import { COLLECTIONS } from './schemas.js';

/**
 * Initialize database collections and indexes for the prediction marketplace
 */
export async function initialize_database(): Promise<void> {
  const db = get_database();
  
  console.log('🔧 Initializing database collections and indexes...');

  // Create collections if they don't exist (MongoDB creates them automatically on first insert)
  const collections = Object.values(COLLECTIONS);
  for (const collection of collections) {
    await db.createCollection(collection).catch(() => {
      // Collection already exists, continue
    });
  }

  // Create indexes for performance
  await create_indexes();
  
  console.log('✅ Database initialization complete');
}

async function create_indexes(): Promise<void> {
  const db = get_database();

  // Auctions collection indexes
  await db.collection(COLLECTIONS.auctions).createIndex({ bat_id: 1 }, { unique: true });
  await db.collection(COLLECTIONS.auctions).createIndex({ status: 1 });
  await db.collection(COLLECTIONS.auctions).createIndex({ end_date: 1 });
  await db.collection(COLLECTIONS.auctions).createIndex({ make: 1, model: 1 });

  // Auction observations indexes
  await db.collection(COLLECTIONS.auction_observations).createIndex({ auction_id: 1 });
  await db.collection(COLLECTIONS.auction_observations).createIndex({ auction_id: 1, observed_at: -1 });

  // Auction snapshots indexes
  await db.collection(COLLECTIONS.auction_snapshots).createIndex({ auction_id: 1 });
  await db.collection(COLLECTIONS.auction_snapshots).createIndex({ auction_id: 1, snapshot_type: 1 });
  await db.collection(COLLECTIONS.auction_snapshots).createIndex({ auction_id: 1, created_at: -1 });
  await db.collection(COLLECTIONS.auction_snapshots).createIndex({ html_hash: 1 });

  // Auction close validation indexes
  await db.collection(COLLECTIONS.auctions).createIndex({ close_validation_state: 1 });

  // Events collection indexes
  await db.collection(COLLECTIONS.events).createIndex({ slug: 1 }, { unique: true });
  await db.collection(COLLECTIONS.events).createIndex({ auction_id: 1 });
  await db.collection(COLLECTIONS.events).createIndex({ status: 1 });

  // Markets collection indexes
  await db.collection(COLLECTIONS.markets).createIndex({ slug: 1 }, { unique: true });
  await db.collection(COLLECTIONS.markets).createIndex({ event_id: 1 });
  await db.collection(COLLECTIONS.markets).createIndex({ status: 1 });
  await db.collection(COLLECTIONS.markets).createIndex({ trading_ends_at: 1 });

  // Outcomes collection indexes
  await db.collection(COLLECTIONS.outcomes).createIndex({ market_id: 1 });
  await db.collection(COLLECTIONS.outcomes).createIndex({ market_id: 1, sort_order: 1 });

  // Users collection indexes
  await db.collection(COLLECTIONS.users).createIndex({ email: 1 }, { unique: true });
  await db.collection(COLLECTIONS.users).createIndex({ username: 1 }, { unique: true });
  await db.collection(COLLECTIONS.users).createIndex({ primary_wallet_address: 1 }, { sparse: true });

  // Wallets collection indexes
  await db.collection(COLLECTIONS.wallets).createIndex({ user_id: 1 });
  await db.collection(COLLECTIONS.wallets).createIndex({ address: 1, chain: 1 }, { unique: true });

  // User balances indexes
  await db.collection(COLLECTIONS.user_balances).createIndex({ user_id: 1, currency: 1 }, { unique: true });

  // Ledger entries indexes
  await db.collection(COLLECTIONS.ledger_entries).createIndex({ user_id: 1 });
  await db.collection(COLLECTIONS.ledger_entries).createIndex({ user_id: 1, created_at: -1 });
  await db.collection(COLLECTIONS.ledger_entries).createIndex({ reference_type: 1, reference_id: 1 });

  // Orders collection indexes
  await db.collection(COLLECTIONS.orders).createIndex({ user_id: 1 });
  await db.collection(COLLECTIONS.orders).createIndex({ market_id: 1, outcome_id: 1 });
  await db.collection(COLLECTIONS.orders).createIndex({ market_id: 1, outcome_id: 1, side: 1, status: 1 });
  await db.collection(COLLECTIONS.orders).createIndex({ status: 1 });
  await db.collection(COLLECTIONS.orders).createIndex({ created_at: 1 });

  // Trades collection indexes
  await db.collection(COLLECTIONS.trades).createIndex({ market_id: 1, outcome_id: 1 });
  await db.collection(COLLECTIONS.trades).createIndex({ buyer_user_id: 1 });
  await db.collection(COLLECTIONS.trades).createIndex({ seller_user_id: 1 });
  await db.collection(COLLECTIONS.trades).createIndex({ buyer_order_id: 1 });
  await db.collection(COLLECTIONS.trades).createIndex({ seller_order_id: 1 });
  await db.collection(COLLECTIONS.trades).createIndex({ timestamp: -1 });
  await db.collection(COLLECTIONS.trades).createIndex({ market_id: 1, timestamp: -1 });

  // Positions collection indexes
  await db.collection(COLLECTIONS.positions).createIndex({ user_id: 1 });
  await db.collection(COLLECTIONS.positions).createIndex({ user_id: 1, market_id: 1, outcome_id: 1 }, { unique: true });
  await db.collection(COLLECTIONS.positions).createIndex({ market_id: 1 });
  await db.collection(COLLECTIONS.positions).createIndex({ is_settled: 1 });

  // Resolution proposals indexes
  await db.collection(COLLECTIONS.resolution_proposals).createIndex({ market_id: 1 });
  await db.collection(COLLECTIONS.resolution_proposals).createIndex({ event_id: 1 });
  await db.collection(COLLECTIONS.resolution_proposals).createIndex({ status: 1 });

  // Admin actions indexes  
  await db.collection(COLLECTIONS.admin_actions).createIndex({ admin_user_id: 1 });
  await db.collection(COLLECTIONS.admin_actions).createIndex({ target_type: 1, target_id: 1 });
  await db.collection(COLLECTIONS.admin_actions).createIndex({ created_at: -1 });

  // Risk flags indexes
  await db.collection(COLLECTIONS.risk_flags).createIndex({ user_id: 1 }, { sparse: true });
  await db.collection(COLLECTIONS.risk_flags).createIndex({ market_id: 1 }, { sparse: true });
  await db.collection(COLLECTIONS.risk_flags).createIndex({ is_resolved: 1 });
  await db.collection(COLLECTIONS.risk_flags).createIndex({ severity: 1 });

  console.log('📊 Database indexes created');
}

/**
 * Create sample data for development and testing
 */
export async function create_sample_data(): Promise<void> {
  const db = get_database();
  
  console.log('🔧 Creating sample data...');

  // Check if sample data already exists
  const existing_auctions = await db.collection(COLLECTIONS.auctions).countDocuments();
  if (existing_auctions > 0) {
    console.log('📊 Sample data already exists, skipping creation');
    return;
  }

  // Create sample admin user
  const admin_user_result = await db.collection(COLLECTIONS.users).insertOne({
    email: 'admin@marketplace.com',
    username: 'admin',
    is_admin: true,
    is_verified: true,
    kyc_status: 'approved',
    position_limit_usd: 1000000,
    is_suspended: false,
    created_at: new Date(),
    updated_at: new Date()
  });

  const admin_user_id = admin_user_result.insertedId;

  // Create sample auction
  const auction_result = await db.collection(COLLECTIONS.auctions).insertOne({
    bat_id: 'sample-porsche-911-carrera',
    url: 'https://bringatrailer.com/listing/sample-porsche-911-carrera/',
    title: '1989 Porsche 911 Carrera',
    make: 'Porsche',
    model: '911',
    year: 1989,
    reserve_status: 'no_reserve',
    start_date: new Date('2024-01-15T10:00:00Z'),
    end_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
    original_end_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    is_live: true,
    current_bid: 85000,
    bid_count: 23,
    extension_count: 0,
    close_validation_state: 'unvalidated',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: admin_user_id
  });

  const auction_id = auction_result.insertedId;

  // Create sample event
  const event_result = await db.collection(COLLECTIONS.events).insertOne({
    title: '1989 Porsche 911 Carrera Final Price',
    description: 'Predict the final closing price of this iconic 1989 Porsche 911 Carrera',
    auction_id,
    slug: '1989-porsche-911-carrera-final-price',
    resolution_source: 'bat_final_price',
    status: 'published',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: admin_user_id
  });

  const event_id = event_result.insertedId;

  // Create sample threshold market
  const threshold_market_result = await db.collection(COLLECTIONS.markets).insertOne({
    event_id,
    title: 'Will this 1989 Porsche 911 close at or above $100,000?',
    description: 'Binary market on whether the final auction price will be $100,000 or higher',
    slug: 'porsche-911-over-100k',
    type: 'threshold',
    threshold_value: 100000,
    trading_starts_at: new Date(),
    trading_ends_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days from now
    status: 'trading',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: admin_user_id
  });

  const threshold_market_id = threshold_market_result.insertedId;

  // Create outcomes for threshold market
  await db.collection(COLLECTIONS.outcomes).insertMany([
    {
      market_id: threshold_market_id,
      title: 'Yes',
      slug: 'yes',
      sort_order: 1,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      market_id: threshold_market_id,
      title: 'No',
      slug: 'no',
      sort_order: 2,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  // Create sample bucket market
  const bucket_market_result = await db.collection(COLLECTIONS.markets).insertOne({
    event_id,
    title: 'Which price range will this Porsche 911 close in?',
    description: 'Multi-outcome market for the final auction price range',
    slug: 'porsche-911-price-range',
    type: 'bucket',
    bucket_ranges: [
      { min: 0, max: 75000, label: 'Under $75K' },
      { min: 75000, max: 100000, label: '$75K - $100K' },
      { min: 100000, max: 125000, label: '$100K - $125K' },
      { min: 125000, label: 'Over $125K' }
    ],
    trading_starts_at: new Date(),
    trading_ends_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days from now
    status: 'trading',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: admin_user_id
  });

  const bucket_market_id = bucket_market_result.insertedId;

  // Create outcomes for bucket market
  await db.collection(COLLECTIONS.outcomes).insertMany([
    {
      market_id: bucket_market_id,
      title: 'Under $75K',
      slug: 'under-75k',
      sort_order: 1,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      market_id: bucket_market_id,
      title: '$75K - $100K',
      slug: '75k-100k',
      sort_order: 2,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      market_id: bucket_market_id,
      title: '$100K - $125K',
      slug: '100k-125k',
      sort_order: 3,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      market_id: bucket_market_id,
      title: 'Over $125K',
      slug: 'over-125k',
      sort_order: 4,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  // Create some auction observations
  const now = new Date();
  await db.collection(COLLECTIONS.auction_observations).insertMany([
    {
      auction_id,
      observed_at: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      current_bid: 82000,
      bid_count: 20,
      time_left_seconds: 5 * 24 * 60 * 60, // 5 days
      is_extended: false,
      extension_detected: false,
      created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000)
    },
    {
      auction_id,
      observed_at: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
      current_bid: 84000,
      bid_count: 22,
      time_left_seconds: 5 * 24 * 60 * 60 - 3600, // slightly less
      is_extended: false,
      extension_detected: false,
      created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000)
    },
    {
      auction_id,
      observed_at: now,
      current_bid: 85000,
      bid_count: 23,
      time_left_seconds: 5 * 24 * 60 * 60 - 7200, // 5 days minus 2 hours
      is_extended: false,
      extension_detected: false,
      created_at: now
    }
  ]);

  console.log('✅ Sample data created successfully');
}