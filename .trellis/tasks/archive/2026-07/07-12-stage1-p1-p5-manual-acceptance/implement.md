# Manual acceptance procedure

1. Open `http://127.0.0.1:5173/`; use Demo mode. If the login screen appears, choose the demo entry.
2. Execute P1-P5 in order from `prd.md`.
3. Record each result in `manual-results.md` as `PASS`, `FAIL`, or `BLOCKED`, including the visible node/item name and error text where relevant.
4. For a failure, preserve the page state and report the exact step, expected behavior and observed behavior before refreshing.
5. After all user results arrive, reproduce and fix failures, then run focused checks, `npm run typecheck`, and `npm run build`.
