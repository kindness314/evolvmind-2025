# Stage 1 acceptance and blocker fixes

## Goal

Validate the implemented Stage 1 knowledge workflow against real demo data, fix the already identified blockers that prevent acceptance, and record only behavior that has been directly verified.

## Requirements

- Run the full local stack and use `http://127.0.0.1:5173/` in demo mode.
- Validate the P1 knowledge-node detail path: node selection, responsive detail panel, sources, relationships, original-item navigation, return behavior, empty states and query failure behavior where reproducible.
- Confirm the known P4 node recommendation navigation mismatch between `knowledge-graph` and the actual `knowledge` page value; fix it if present.
- Review P3/P4 API scope handling. Request-body `scope_id` must not create cross-user access; authenticated requests must derive user scope from verified auth context, while demo requests must follow the existing shared fallback UUID policy.
- Preserve state-based navigation, demo behavior, RLS assumptions and existing API response compatibility.
- Do not claim semantic-search end-to-end acceptance while the configured embedding key returns `ModelNotAllowed`.
- Do not add unrelated Stage 2/3 features, broad modularization, schema changes or dependency cleanup.

## Acceptance Criteria

- [ ] Full local frontend and API services start successfully.
- [ ] Demo mode reaches the Home and Knowledge pages without a runtime error.
- [ ] Selecting a real graph node opens its detail panel and displays available node metadata.
- [ ] Available source content opens `ItemDetailPage`; returning preserves usable navigation state.
- [ ] Nodes with missing sources or relationships show explicit empty states rather than crashing.
- [ ] Recommendation targets of type `node` navigate to the actual Knowledge page and request the intended node focus/detail behavior.
- [ ] P3/P4 server queries cannot use an arbitrary request-body user scope to read another authenticated user's data.
- [ ] Focused typecheck, build, API and browser checks pass for all modified behavior.
- [ ] External embedding permission remains documented as a blocker rather than reported as passing.
- [ ] Project memory and Trellis session records reflect the verified outcome and remaining blockers.

## Notes

- Current demo graph scope UUID: `00000000-0000-0000-0000-000000000000`.
- Known candidate defect: `HomePage.tsx` may call `onNavigate('knowledge-graph', ...)` while `App.tsx` uses `knowledge`.
- Known risk: summarize/recommend APIs accept request-body scope information and require authorization review.
