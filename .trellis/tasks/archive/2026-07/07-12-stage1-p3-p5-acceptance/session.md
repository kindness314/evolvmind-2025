## Completed

- Defined and validated Stage 1 P3-P5 acceptance criteria.
- P3: verified 7d/30d switching against real demo API responses; observed explicit no-capture summary, 30 nodes, 0 links and five important nodes. Controlled API failure rendered `总结暂不可用` without crashing Home.
- P4: natural demo response remained empty without fabricated cards. Controlled recommendation rendered and dismissed; the dismissed ID was filtered after refetch during the mounted Home session. Controlled 500 failure left Home navigation usable.
- P5: real graph time controls changed 123/123 nodes (all) to 94/123 (7d). Combining 7d with concept category produced 53/123; restoring all time with the category active produced 63/123. Mobile 390x844 controls remained visible and operable.
- No product defect was reproduced, so no source code changed.
- `npm run typecheck` and `npm run build` passed. Production build retained the known 837.80 kB chunk warning.

## Remaining external/data gaps

- Embedding requests remain blocked by `ModelNotAllowed`.
- No real authenticated non-demo user was available.
- Natural demo recommendation data remains empty.
- P3 real 7d/30d datasets currently have identical statistics, so a real temporal-boundary difference was unavailable.
- P5 search + time and focused-node cross-time context were not independently covered.
