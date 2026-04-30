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
- **Real-time**: Socket.IO 4.x (backend) + socket.io-client 4.x (frontend)
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
- `GET /api/trading/my-trades` - User's personal trade history (auth required)
- `GET /api/trading/positions` - User's open positions (auth required)
- `GET /api/trading/position-summary` - User's position summary with P&L (auth required)
- `GET /api/trading/statistics/:market_id` - Trade statistics for a market
- `POST /api/trading/trigger-matching/:market_id/:outcome_id` - Admin match trigger (rate limited: 5/min)
- `POST /api/trading/trigger-all-matching` - Trigger all markets (rate limited: 5/min)

### Reconciliation
- `GET /api/admin/reconciliation` - Full system reconciliation report
- `GET /api/admin/reconciliation/orders/:order_id` - Reconcile specific order
- `GET /api/admin/reconciliation/markets/:market_id/orders` - Reconcile all orders for market
- `GET /api/trading/reconciliation/balance` - User balance reconciliation (auth required)
- `GET /api/trading/reconciliation/positions` - User position reconciliation (auth required)
- `GET /api/trading/reconciliation/orders/:order_id` - User order reconciliation (auth required)

### Auction Close Detection & Evidence (Tasks 5.1–5.5)
- `GET /api/auctions/:id/close-validation` - Close validation state with 5-check result
- `GET /api/auctions/:id/snapshots` - List archived evidence snapshots (raw_html excluded)
- `GET /api/auctions/:id/snapshots/:snapshotId` - Full snapshot with raw HTML for review
- `POST /api/auctions/:id/confirm-close` - Admin manual close confirmation
- `GET /api/auctions/:id/linked-markets` - Prediction markets tied to this auction

**New Services:**
- `auctionCloseService` (`backend/services/auction-close-service.ts`) - Extension detection, close validation, evidence archiving, linked-market lookup, admin confirm-close
- Enhanced `bat-parser.ts` - `extractWinningBidder()`, `extractExtensionInfo()`, improved sold-price text fallbacks

**Background Tasks:**
- `start_auction_poll_checker(60000)` - Polls auctions needing attention every 60s (active, extended, near-end, recently closed awaiting confirmation, draft)
- Integrated into graceful shutdown alongside `stop_market_status_checker`

### Health & Monitoring
- `GET /api/health` - System health (MongoDB + Redis + WebSocket status)
- `GET /api/health/websocket` - WebSocket connection statistics

### WebSocket Events (Socket.IO)
- `authenticate` - Authenticate socket with JWT token (verified against `JWT_TOKEN` secret)
- `subscribe_market` - Subscribe to market updates
- `unsubscribe_market` - Unsubscribe from market updates
- `subscribe_orderbook` - Subscribe to order book updates
- `ping` / `pong` - Connection health check
- Server emits: `market_update`, `trade_executed`, `orderbook_update`, `order_filled`, `order_placed`, `order_cancelled`, `auction_closed`

### Frontend WebSocket Integration
- **Context**: `frontend/src/contexts/WebSocketContext.tsx` — React context managing socket connection, subscriptions, and reactive data stores
  - State: `connected`, `authenticated`, `trades`, `orderBooks`, `marketStatuses`, `lastPrices`, `orderFills`
  - Events handled: `trade_executed`, `orderbook_update`, `market_update` (status & price), `order_filled`
  - Bug fix: Added missing `useRef` import for `socketRef`
- **Hook**: `frontend/src/hooks/useWebSocket.ts` — Lower-level hook for direct socket access
- **Features**: Auto-reconnection, JWT auth, live trade feed, order book streaming, market status updates, price tickers, order fill toasts

### Frontend Trading Components
- `OrderBook` — Depth-bar order book with spread/mid/last price
- `TradeHistory` — Tabbed market trades (REST + WS) and personal trade history
- `PositionsPanel` — Open positions with P&L, long/short badges, market value
- `PriceTicker` — Per-outcome BBO ticker with one-click order price fill
- `TradeToast` — Floating toast notifications for order fills
