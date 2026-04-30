import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Server as HttpServer } from 'http';
import { connect_to_mongodb, get_database } from './database/connection.js';
import { initialize_database, create_sample_data } from './database/init.js';
import { create_auction_routes } from './routes/auctions.js';
import { create_market_routes } from './routes/markets.js';
import { create_admin_routes } from './routes/admin.js';
import { create_auth_routes } from './routes/auth.js';
import { create_trading_routes } from './routes/trading_routes.js';
import { create_matching_test_routes } from './routes/matching_test.js';
import { connect_to_redis, cache_service, is_redis_available } from './services/redis.js';
import { create_websocket_service, get_websocket_service } from './services/websocket.js';
import { start_market_status_checker, stop_market_status_checker, initialize_status_cache } from './services/market_status.js';
import { start_auction_poll_checker, stop_auction_poll_checker } from './services/auction-service.js';
import { rate_limiters } from './middleware/rate_limit.js';

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

// Apply standard rate limiting to all API routes (task 4.14)
app.use('/api/*', rate_limiters.standard);

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
      health: '/api/health',
      ws: '/ws'
    }
  });
});

// Health check endpoint with Redis status (task 4.10)
app.get('/api/health', async (c) => {
  try {
    const db = get_database();
    // Ping MongoDB to check connection
    await db.admin().ping();

    // Check Redis health
    const redis_health = await cache_service.health_check();

    return c.json({
      status: 'healthy',
      message: 'Car Auction Prediction Marketplace API is running',
      timestamp: new Date().toISOString(),
      mongodb: 'connected',
      redis: redis_health,
      websocket: is_websocket_ready(),
      version: '1.0.0'
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      message: 'API is running but a service connection failed',
      timestamp: new Date().toISOString(),
      mongodb: 'connected',
      redis: await cache_service.health_check().catch(() => ({ status: 'unknown', latency_ms: 0 })),
      error: (error as Error).message
    }, 503);
  }
});

// WebSocket connection stats endpoint (task 4.13)
app.get('/api/health/websocket', async (c) => {
  try {
    const ws = get_websocket_service();
    const stats = ws.get_connection_stats();

    return c.json({
      success: true,
      websocket: {
        status: 'active',
        total_connections: stats.total_connections,
        authenticated_users: stats.authenticated_users,
        subscribed_markets: Object.fromEntries(stats.subscribed_markets)
      }
    });
  } catch (error) {
    return c.json({
      success: true,
      websocket: {
        status: 'inactive',
        total_connections: 0,
        authenticated_users: 0,
        subscribed_markets: {}
      }
    });
  }
});

// Mount route modules
app.route('/api/auctions', create_auction_routes());
app.route('/api/markets', create_market_routes());
app.route('/api/admin', create_admin_routes());
app.route('/api/auth', create_auth_routes());
app.route('/api/trading', create_trading_routes());
app.route('/api/matching-test', create_matching_test_routes());

// Helper to check websocket readiness
function is_websocket_ready(): boolean {
  try {
    get_websocket_service();
    return true;
  } catch {
    return false;
  }
}

// Start server
const port = parseInt(process.env.PORT || '9002', 10);

connect_to_mongodb()
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Initialize database collections and indexes
    await initialize_database();

    // Create sample data for development
    await create_sample_data();

    // Connect to Redis (task 4.10)
    await connect_to_redis();

    // Start HTTP server and attach WebSocket (task 4.13)
    const server = serve({
      fetch: app.fetch,
      port
    }) as HttpServer;

    // Initialize WebSocket service on the same HTTP server
    create_websocket_service(server);
    console.log('🔌 WebSocket server initialized');

    // Initialize market status cache and start periodic checker (task 4.19)
    await initialize_status_cache();
    start_market_status_checker(30000);

    // Start auction close detection and polling monitor (tasks 5.1–5.5)
    start_auction_poll_checker(60000); // Poll every 60 seconds

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      stop_market_status_checker();
      stop_auction_poll_checker();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      stop_market_status_checker();
      stop_auction_poll_checker();
      process.exit(0);
    });

    console.log(`🚀 Car Auction Prediction Marketplace API running on http://localhost:${port}`);
    console.log(`📊 API endpoints available at:`);
    console.log(`   - GET  /api/health`);
    console.log(`   - GET  /api/health/websocket`);
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
