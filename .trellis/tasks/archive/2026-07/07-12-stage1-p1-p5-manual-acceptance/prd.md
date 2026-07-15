# Stage 1 P1-P5 manual acceptance

## Test environment

- Frontend: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:3000/api/*`
- Mode: demo (`localStorage.demo_auth = true`)
- Seed data: 15 captured items, 123 nodes, 137 links; completion dataset tag `completion-test-20260606`.

## Goal

Have the user manually accept P1-P5 using the fixed local environment. Record every step as Pass, Fail, Blocked, or Not Applicable with concise evidence. Reproduced product defects are fixed in this task before archive.

## Acceptance criteria

### P1 Node detail
- [ ] Open a real node and verify name, type, aliases, sources, neighbor relations, Chinese relation explanation and evidence.
- [ ] Open a source item, return, close detail, and confirm graph state remains usable.
- [ ] Check desktop side panel and mobile bottom sheet.

### P2 Search and graph linkage
- [ ] Home keyword result opens captured-item detail.
- [ ] Result presents summary/match explanation where available.
- [ ] Graph search opens node detail and `在图谱中聚焦` centers the node.
- [ ] Embedding denial is explicitly shown as unavailable/fallback, not disguised as no results.

### P3 Recent summary
- [ ] Switch 7 days and 30 days; verify loading, statistics, important nodes, narrative and suggestions.
- [ ] Verify no-capture/fallback wording is explicit and the Home page remains usable.

### P4 Recommendations
- [ ] Natural recommendation cards, if present, navigate to their captured/node targets.
- [ ] Closing a card removes it for the current mounted Home session.
- [ ] An empty recommendation response produces no fabricated cards.

### P5 Time evolution
- [ ] Switch all/7d/30d and verify counts and new-node highlighting.
- [ ] Combine time with category and search; return to all without a blank graph.
- [ ] Repeat time controls at a mobile viewport.

## Known blockers

- MiniMax embeddings currently return `ModelNotAllowed`; true semantic search is Blocked until a permitted server key/model is available.
- Demo API may return no natural recommendations; recommendation-rule coverage may be Blocked by data.
- Current real 7d/30d summary datasets may produce identical statistics.
