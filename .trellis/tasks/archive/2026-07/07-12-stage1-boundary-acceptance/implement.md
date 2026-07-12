# Stage 1 Boundary Acceptance Plan

1. Inspect node-detail request shape and UI branches.
2. Use browser request interception to return controlled node/source/relation responses for empty and failure states.
3. Query demo recommendations and identify captured and node targets.
4. Exercise recommendation clicks in the browser; intercept only the recommendation response if deterministic data is required.
5. Exercise demo scope tampering and invalid bearer-token API cases.
6. Apply minimal fixes for reproduced defects.
7. Run `npm run typecheck`, `npm run build`, focused API calls and browser scenarios.
8. Update memory/session records and archive the task.
