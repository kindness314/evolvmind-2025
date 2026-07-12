# Stage 1 P3-P5 acceptance

## Goal

Validate the remaining locally testable Stage 1 behavior for recent summaries, recommendation interaction states, and knowledge-graph time evolution; repair reproduced defects without expanding product scope.

## Requirements

- Validate P3 7-day and 30-day summary switching with real demo responses, including statistics, deterministic/LLM fallback messaging, loading and API failure behavior.
- Validate P4 natural empty state, controlled recommendation display, dismissal persistence for the current page session, and API failure isolation from the Home page.
- Validate P5 all/7d/30d filtering with real demo nodes, category/search/focus combinations, empty ranges where available, and mobile controls.
- Use browser request interception only for deterministic error/interaction branches unavailable from current data; distinguish controlled checks from real-data checks.
- Keep semantic search external embedding failure out of the acceptance result.

## Acceptance Criteria

- [ ] P3 switches between 7d and 30d without stale-period content.
- [ ] P3 renders real statistics/content or an explicit empty/fallback state.
- [ ] P3 API failure is visible and does not crash Home.
- [ ] P4 natural empty response does not show fabricated recommendations.
- [ ] P4 controlled recommendations render, dismiss, and remain dismissed for the current mounted Home session.
- [ ] P4 API failure leaves search, captured content and navigation usable.
- [ ] P5 all/7d/30d controls update visible graph counts/content.
- [ ] P5 combines with category, node focus and return-to-all behavior without a blank graph or crash.
- [ ] P5 controls are usable in a mobile viewport.
- [ ] Typecheck, production build and focused browser/API checks pass.
