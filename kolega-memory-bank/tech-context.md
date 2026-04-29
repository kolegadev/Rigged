# Tech Context

## Technologies Used
- **Runtime**: Node.js 19
- **Frontend Framework**: React 19.1.0 + Vite 7.0.4
- **Backend Framework**: Hono 4.6.14
- **Language**: TypeScript 5.8.3
- **Styling**: Tailwind CSS 3.4.17
- **UI Components**: shadcn/ui + Radix UI primitives
- **Database**: MongoDB (via mongodb driver 6.12.0)
- **Cache / PubSub**: Redis via ioredis 5.x (with in-memory fallback)
- **Real-time**: Socket.IO 4.x
- **Authentication**: bcryptjs + jsonwebtoken
- **Validation**: Zod

## Development Setup
Dependencies installed for both frontend and backend. Both projects build successfully.

## Key Commands
```bash
# Frontend
cd frontend && npm run dev      # Start dev server
cd frontend && npm run build    # Production build
cd frontend && npm run lint     # Run ESLint

# Backend
cd backend && npm run dev       # Start dev server with tsc-watch
cd backend && npm run build     # Compile TypeScript
cd backend && npm run start     # Run compiled output
```

## Environment Variables
- MongoDB connection URI and database name are provided by the workspace environment
- Redis connection uses `REDIS_API` (host:port) and `REDIS_DATABASE_NAME` (password fallback)
- Backend should read these via `process.env`

## Ports
- Frontend dev server: 5173 (Vite default)
- Backend server: 9002 (configured in project)
- WebSocket server: attached to same HTTP server as backend (port 9002)

## API Endpoints

### Trading
- `GET /api/trading/orderbook/:market_id/:outcome_id` - Order book snapshot (rate limited: 300/min)
- `GET /api/trading/depth/:market_id/:outcome_id` - Market depth (rate limited: 300/min)
- `GET /api/trading/bbo/:market_id/:outcome_id` - Best bid/offer (rate limited: 300/min)
- `GET /api/trading/trades/:market_id` - Market trade history (rate limited: 300/min)
- `GET /api/trading/recent-trades/:market_id/:outcome_id` - Recent trades for display (rate limited: 300/min)
- `POST /api/trading/trigger-matching/:market_id/:outcome_id` - Admin match trigger (rate limited: 5/min)
- `POST /api/trading/trigger-all-matching` - Trigger all markets (rate limited: 5/min)

### Reconciliation
- `GET /api/admin/reconciliation` - Full system reconciliation report
- `GET /api/admin/reconciliation/orders/:order_id` - Reconcile specific order
- `GET /api/admin/reconciliation/markets/:market_id/orders` - Reconcile all orders for market
- `GET /api/trading/reconciliation/balance` - User balance reconciliation (auth required)
- `GET /api/trading/reconciliation/positions` - User position reconciliation (auth required)
- `GET /api/trading/reconciliation/orders/:order_id` - User order reconciliation (auth required)

### Health & Monitoring
- `GET /api/health` - System health (MongoDB + Redis + WebSocket status)
- `GET /api/health/websocket` - WebSocket connection statistics

### WebSocket Events (Socket.IO)
- `authenticate` - Authenticate socket with user token
- `subscribe_market` - Subscribe to market updates
- `unsubscribe_market` - Unsubscribe from market updates
- `subscribe_orderbook` - Subscribe to order book updates
- `ping` / `pong` - Connection health check
- Server emits: `market_update`, `trade_executed`, `orderbook_update`, `order_filled`
