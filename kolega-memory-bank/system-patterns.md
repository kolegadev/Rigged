# System Patterns

## Architecture
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Hono (Node.js) + TypeScript + MongoDB + Redis (with in-memory fallback)
- **Proxy**: Frontend proxies `/api` requests to backend during development

## Key Directories
```
/
├── frontend/          # React Vite application
│   ├── src/
│   │   ├── pages/     # Route pages (Markets, etc.)
│   │   ├── components/# UI components
│   │   └── ...
│   └── package.json
├── backend/           # Hono API server
│   ├── routes/        # API route handlers
│   ├── services/      # Business logic
│   ├── middleware/    # Auth & other middleware
│   ├── database/      # DB connections/models
│   └── index.ts       # Entry point
├── contracts/         # Shared types/contracts
└── kolega-memory-bank/# Project documentation
```

## Design Patterns
- Component-based UI with shadcn/ui primitives
- Route-based page organization in frontend
- Service-layer architecture in backend
- Middleware-based authentication
- Environment-based configuration
- Graceful degradation: Redis unavailable → in-memory fallback

## Core Services
- **order_service** (`backend/services/orders.ts`) - Places/cancels orders, locks funds
- **matching_engine** (`backend/services/matching_engine.ts`) - Price-time priority matching, publishes market updates via Redis
- **trade_execution** (`backend/services/trade_execution.ts`) - Atomic trade creation, fund transfers, publishes trade events via Redis/WebSocket
- **position_engine** (`backend/services/position_engine.ts`) - Position tracking and P&L
- **balance_service** (`backend/services/balance.ts`) - Balance locking/unlocking/transfer + ledger entries
- **order_book** (`backend/services/order_book.ts`) - Order book aggregation with Redis caching (30s TTL) and snapshot versioning
- **reconciliation_service** (`backend/services/reconciliation.ts`) - Order/trade/balance/position reconciliation
- **CacheService** (`backend/services/redis.ts`) - Redis-backed caching with in-memory fallback for order books, sessions, rate limits, pub/sub, leaderboards
- **WebSocketService** (`backend/services/websocket.ts`) - Socket.IO server with Redis pub/sub integration for real-time market data, order books, and trade feeds

## Order Status Lifecycle
Orders use lowercase status enums stored in MongoDB:
- `active` - In the order book, available for matching
- `partial` - Partially filled, still available for matching
- `filled` - Fully filled
- `cancelled` - Cancelled by user
- `expired` - Time-in-force expired

**Critical**: All queries for active orders must use `['active', 'partial']`.

## Trade Execution Flow
1. User places order → `order_service.place_order()` → funds locked + order inserted as `active`
2. Matching engine triggered → finds overlapping buy/sell orders
3. `trade_execution.execute_trade()` runs in MongoDB transaction:
   - Creates trade record in `trades` collection
   - Updates both orders' filled/remaining quantities and status
   - Calls `balance_service.transfer_funds()` (moves locked funds buyer → seller)
   - Writes ledger entries for both parties inside the transaction
4. Post-transaction: `position_engine.update_positions_from_trade()` updates holdings
5. Order book cache is refreshed, Redis pub/sub events emitted, WebSocket broadcasts sent

## Real-time Data Flow (Tasks 4.10–4.14)
1. Order book snapshots cached in Redis (or in-memory fallback) with 30s TTL
2. On trade execution:
   - `cache_service.publish_trade_execution()` sends to Redis `trades:{market_id}:{outcome_id}` channel
   - `WebSocketService.notify_trade_execution()` broadcasts to connected Socket.IO clients
3. On order book refresh:
   - `cache_service.publish_orderbook_update()` sends to Redis `orderbook_updates:{market_id}:{outcome_id}` channel
   - `WebSocketService.notify_orderbook_update()` broadcasts to subscribed clients
4. Rate limiting applied via `CacheService.check_rate_limit()` using Redis sorted sets (or in-memory fallback counters)
   - Standard API: 100 req/min
   - Market data: 300 req/min
   - Order placement: 10 req/min
   - Auth endpoints: 5 req/min
   - Admin triggers: 5 req/min

## Redis Cloud Configuration
- Host/port parsed from `REDIS_API` env var (e.g. `redis-19972.c80.us-east-1-2.ec2.cloud.redislabs.com:19972`)
- Password from `REDIS_PASSWORD` env var
- Username automatically set to `default` when password is present
- If Redis auth fails, system gracefully falls back to in-memory implementations

## Dev Server Setup
```bash
# Backend
cd backend && npm run dev
# Watches TypeScript and restarts on changes

# Frontend
cd frontend && npm run dev
# Vite HMR dev server
```
