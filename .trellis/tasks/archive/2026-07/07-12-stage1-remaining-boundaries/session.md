## Completed

- Validated graph search with all/7d/30d switching using the real demo graph. Search `学生` remained usable; counts transitioned 123/123 → 94/123 → 94/123 and returned to 123/123.
- Confirmed the product's focus/time contract in `KnowledgePage.tsx`: changing the time range explicitly clears `focusedNodeId`; the graph remains usable. The filtering implementation also preserves the connected component when a center node is outside the range if focus is otherwise retained.
- Inspected P3 asynchronous period handling: each period effect owns a `cancelled` flag and cannot commit its response after cleanup. A controlled browser race could not be completed because Vite HMR repeatedly produced an empty document after request interception; this is recorded as an environment-limited check, not a runtime pass.
- No source defect was reproduced and no product source changed.
- `npm run typecheck` and `npm run build` passed. The known 837.80 kB chunk warning remains.
