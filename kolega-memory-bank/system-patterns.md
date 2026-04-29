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

## Dev Server Setup
```bash
# Backend
cd backend && npm run dev
# Watches TypeScript and restarts on changes

# Frontend
cd frontend && npm run dev
# Vite HMR dev server
```
