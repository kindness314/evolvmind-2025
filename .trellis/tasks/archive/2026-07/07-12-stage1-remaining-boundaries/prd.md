# Stage 1 remaining boundary acceptance

## Goal

Close the locally controllable Stage 1 acceptance gaps for graph search/time composition, focused-node behavior across time ranges, and summary period boundaries.

## Acceptance Criteria

- [ ] Search and 7d/30d graph filters compose without stale results, blank UI, or loss of controls.
- [ ] A focused node remains understandable when switching to a time range that excludes it, or the UI exits focus explicitly without crashing.
- [ ] Controlled 7d/30d summary responses prove the period switch cannot display stale previous-period content.
- [ ] Any reproduced defect is fixed at the source and covered by focused verification.
- [ ] Typecheck and production build pass.
