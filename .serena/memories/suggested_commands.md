# EvolvMind commands (Windows)

- Install: `npm i`
- Frontend only: `npm run dev`; open `http://127.0.0.1:5173/`.
- Full local stack: `npm run dev:full`; frontend remains `5173`, API remains `3000`; use this for `/api/*`, extraction, embedding, and search.
- Quality: `npm run typecheck`; `npm run build`; `npm run preview` for built app.
- Database: `supabase link --project-ref <project-ref>` then `supabase db push`; inspect remote history with `supabase migration list --linked`. Never edit schema manually in Dashboard.
- Trellis task lifecycle: `python ./.trellis/scripts/task.py list`, `start <name>`, `validate <name>`, `finish`, `archive <name>`; add session records with `python ./.trellis/scripts/add_session.py`.
- On Windows, use project-relative paths and Python/npm commands above; frontend browser URL must be the fixed Vite address, not a Vercel dev printed frontend URL.