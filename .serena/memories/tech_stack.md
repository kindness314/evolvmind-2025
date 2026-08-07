# EvolvMind tech stack

- Frontend: React 18.3, TypeScript 5.8, Vite 6.3, Tailwind CSS 4.1, Radix UI primitives, Motion 12, lucide-react.
- Backend/BaaS: Supabase JS 2.x for Auth/Postgres/Storage/Realtime; Vercel Node serverless functions under `api/`.
- AI: MiniMax-compatible server provider; embedding default `BAAI/bge-m3` with 1024 dimensions; chat model comes from `MINIMAX_MODEL`.
- Package manager: npm with checked-in `package-lock.json`.
- Relevant scripts: `dev` (Vite 127.0.0.1:5173), `dev:api` (Vercel API 127.0.0.1:3000), `dev:full` (both), `typecheck` (`tsc --noEmit`), `build` (`vite build`), `preview`.
- Deployment target: Vercel frontend/API + Supabase project. Frontend env: `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_ANON_KEY`; server env: `MINIMAX_API_KEY`, optional `MINIMAX_MODEL`, `MINIMAX_BASE_URL`, `MINIMAX_EMBEDDING_MODEL`.