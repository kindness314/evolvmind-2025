# Stage 1 Acceptance Implementation Plan

1. Start `npm run dev:full`; verify frontend and API health.
2. Enter demo mode and smoke-test Home and Knowledge pages.
3. Exercise a real node detail panel, source navigation and return path; capture empty/error limitations precisely.
4. Inspect and reproduce the recommendation node-target navigation path.
5. Inspect summarize/recommend authorization and scope query construction.
6. Apply the smallest fixes for reproduced navigation and scope defects.
7. Re-run focused browser/API scenarios, `npm run typecheck`, and `npm run build`.
8. Update Claude project memory and Trellis session history with observed results and unresolved external blockers.
9. Validate and archive this Trellis task.

## Review Gates

- No URL router or global state library.
- No service key or provider secret exposed to the browser.
- No arbitrary request-body scope accepted as authenticated authorization.
- Demo shared scope remains explicit and unchanged.
- Embedding `ModelNotAllowed` is not mislabeled as success.
