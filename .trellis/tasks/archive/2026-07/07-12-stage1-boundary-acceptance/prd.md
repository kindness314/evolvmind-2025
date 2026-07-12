# Stage 1 boundary acceptance

## Goal

Complete the remaining directly testable Stage 1 acceptance boundaries after the core P1 flow and first security fixes: node-detail empty/failure states, recommendation target behavior, and request-scope authorization behavior.

## Requirements

- Exercise node-detail states without permanently modifying production/demo data. Use controlled browser network interception or deterministic local responses where necessary.
- Verify explicit UI for a node with no sources, a node with no relations, and a detail-query failure that leaves the graph usable.
- Verify recommendation cards produced by the demo API can open captured targets and node targets using the actual frontend navigation contract.
- Verify demo requests are fixed to the shared demo UUID regardless of attacker-supplied `scope_id`.
- Verify missing and invalid bearer tokens return 401 for protected summary/recommend endpoints.
- Review authenticated-query behavior statically and through token validation where available; do not fabricate a real-user login if no credential is available.
- Fix only defects reproduced by these checks.

## Acceptance Criteria

- [ ] No-source detail displays an explicit source empty state.
- [ ] No-relation detail displays an explicit relation empty state.
- [ ] Detail-query failure displays a visible error and the graph remains operable.
- [ ] Demo recommendations include valid captured/node targets when source data supports them.
- [ ] Captured recommendations open `ItemDetailPage`.
- [ ] Node recommendations navigate to Knowledge and open/focus the target node.
- [ ] `demo: true` ignores arbitrary request-body scope identifiers.
- [ ] Missing/invalid authentication returns 401.
- [ ] Typecheck, production build and focused browser/API verification pass.
- [ ] Remaining external or credential-dependent checks are recorded precisely.
