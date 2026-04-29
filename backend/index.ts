import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { connect_to_mongodb, get_database } from './database/connection.js';
import { initialize_database, create_sample_data } from './database/init.js';
import { create_auction_routes } from './routes/auctions.js';
import { create_market_routes } from './routes/markets.js';
import { create_admin_routes } from './routes/admin.js';
import { create_auth_routes } from './routes/auth.js';
import { create_trading_routes } from './routes/trading_routes.js';
import { create_matching_test_routes } from './routes/matching_test.js';
// Note: Redis imports would be added when ioredis is installed
// import { connect_to_redis, cache_service } from './services/redis.js';
// import { create_websocket_service } from './services/websocket.js';

// Create Hono app
const app = new Hono();

// Configure CORS to accept requests from any host
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['*'],
  exposeHeaders: ['*'],
  credentials: true
}));

// Basic route
app.get('/', (c) => {
  return c.json({ 
    message: 'Car Auction Prediction Marketplace API',
    version: '1.0.0',
    services: ['auctions', 'markets', 'admin', 'auth', 'trading', 'matching-test'],
    endpoints: {
      auctions: '/api/auctions',
      markets: '/api/markets', 
      admin: '/api/admin',
      auth: '/api/auth',
      trading: '/api/trading',
      'matching-test': '/api/matching-test',
      health: '/api/health'
    }
  });
});

// Health check endpoint
app.get('/api/health', async (c) => {
  try {
    const db = get_database();
    // Ping MongoDB to check connection
    await db.admin().ping();
    
    return c.json({
      status: 'healthy',
      message: 'Car Auction Prediction Marketplace API is running',
      timestamp: new Date().toISOString(),
      mongodb: 'connected',
      version: '1.0.0'
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      message: 'API is running but MongoDB connection failed',
      timestamp: new Date().toISOString(),
      mongodb: 'disconnected',
      error: error.message
    }, 503);
  }
});

// Mount route modules
app.route('/api/auctions', create_auction_routes());
app.route('/api/markets', create_market_routes());
app.route('/api/admin', create_admin_routes());
app.route('/api/auth', create_auth_routes());
app.route('/api/trading', create_trading_routes());
app.route('/api/matching-test', create_matching_test_routes());

// Start server
const port = parseInt(process.env.PORT || '9002', 10);

connect_to_mongodb()
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    // Initialize database collections and indexes
    await initialize_database();
    
    // Create sample data for development
    await create_sample_data();
    
    serve({
      fetch: app.fetch,
      port
    });
    console.log(`🚀 Car Auction Prediction Marketplace API running on http://localhost:${port}`);
    console.log(`📊 API endpoints available at:`);
    console.log(`   - GET  /api/health`);
    console.log(`   - GET  /api/auctions`);
    console.log(`   - GET  /api/markets`);
    console.log(`   - POST /api/admin/auctions/import`);
    console.log(`   - POST /api/admin/events`);
    console.log(`   - POST /api/admin/markets`);
  })
  .catch((error: unknown) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
  