# EvolvMind task completion checks

- For source changes, run focused behavioral smoke coverage first, then `npm run typecheck` and `npm run build` from `EvolvMind/`.
- For Trellis tasks, run `python ./.trellis/scripts/task.py validate <task-name>` after updating task artifacts/context; archive only after all acceptance criteria and user-visible evidence are complete.
- For database/security migrations, run `supabase db push --linked --yes`, then `supabase migration list --linked` and a targeted remote smoke check; do not claim real-user isolation without two authenticated test accounts.
- Record manual acceptance as PASS/FAIL/BLOCKED with exact step, visible item/error, browser context, and evidence. Known large Vite chunk warnings are non-fatal unless build exits nonzero.
- Keep durable project conventions in memories/specs; keep one-off task progress in `.trellis/tasks/` and workspace journals.