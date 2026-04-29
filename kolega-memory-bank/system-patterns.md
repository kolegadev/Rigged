# System Patterns

## Architecture
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Hono (Node.js) + TypeScript + MongoDB
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

## Core Services
- **order_service** (`backend/services/orders.ts`) - Places/cancels orders, locks funds
- **matching_engine** (`backend/services/matching_engine.ts`) - Price-time priority matching
- **trade_execution** (`backend/services/trade_execution.ts`) - Atomic trade creation, fund transfers
- **position_engine** (`backend/services/position_engine.ts`) - Position tracking and P&L
- **balance_service** (`backend/services/balance.ts`) - Balance locking/unlocking/transfer + ledger entries
- **order_book** (`backend/services/order_book.ts`) - Order book aggregation with Redis caching
- **reconciliation_service** (`backend/services/reconciliation.ts`) - Order/trade/balance/position reconciliation

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
5. Order book cache is refreshed and events are emitted

## Dev Server Setup
```bash
# Backend
cd backend && npm run dev
# Watches TypeScript and restarts on changes

# Frontend
cd frontend && npm run dev
# Vite HMR dev server
```
