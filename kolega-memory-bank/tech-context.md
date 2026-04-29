# Tech Context

## Technologies Used
- **Runtime**: Node.js 19
- **Frontend Framework**: React 19.1.0 + Vite 7.0.4
- **Backend Framework**: Hono 4.6.14
- **Language**: TypeScript 5.8.3
- **Styling**: Tailwind CSS 3.4.17
- **UI Components**: shadcn/ui + Radix UI primitives
- **Database**: MongoDB (via mongodb driver 6.12.0)
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
- Backend should read these via `process.env`

## Ports
- Frontend dev server: 5173 (Vite default)
- Backend server: 9002 (configured in project)
