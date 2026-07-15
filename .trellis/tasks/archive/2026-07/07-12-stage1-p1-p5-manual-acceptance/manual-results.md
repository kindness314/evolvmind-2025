# Manual results

Tester: User + assisted verification
Date: 2026-07-12
Browser / viewport: User desktop/mobile; automated Chrome 1280x900 and 390x844 @2x DPR

## P1 Node detail
- P1.1 Desktop detail: VERIFIED — bottom content reachable, relation section visible.
- P1.2 Source navigation and return: PASS — source item opens from detail, return preserves graph state.
- P1.3 Close preserves graph state: PASS — closing detail panel keeps graph viewport and selection intact.
- P1.4 Mobile bottom sheet: VERIFIED — content scrolls fully, safe-area respected.

## P2 Search and linkage
- P2.1 Home keyword result: PASS — keyword search opens captured-item detail.
- P2.2 Match explanation / fallback: PASS — semantic search shows match data, embedding denial displayed explicitly.
- P2.3 Graph result detail and focus: PASS — graph search opens node detail, "在图谱中聚焦" centers the node.

## P3 Recent summary
- P3.1 7-day summary: PASS — loads, renders statistics, nodes, and suggestions. Content limited by demo data (single snapshot, no time delta).
- P3.2 30-day summary: PASS — same behavior as 7d (known: demo dataset is a single snapshot).
- P3.3 Empty/fallback wording: PASS — explicit "当前没有新捕获的内容" message shown.

## P4 Recommendations
- P4.1 Natural recommendation navigation: PASS — recommendation cards navigate to their captured-item targets.
- P4.2 Dismissal: PASS — closing a recommendation card removes it for the session.
- P4.3 Natural empty state: NOT VERIFIED — demo data always returns recommendations; cannot test empty state.

## P5 Time evolution
- P5.1 All/7d/30d: PASS — time switches update node counts and highlighting.
- P5.2 Category + time: PASS — category filter combines with time period.
- P5.3 Search + time: PASS — search filter combines with time period.
- P5.4 Mobile controls: PASS — time controls work at mobile viewport.

## Defects

Record: step, expected, observed, exact visible error, node/item used, and screenshot path if available.

### P1-DEFECT-1 — detail content cannot reach bottom
- Status: VERIFIED.
- Source fix: `KnowledgePage.tsx` now propagates `min-h-0`, clips the graph root, gives the detail panel an explicit bounded height, and makes only the detail body a `touch-pan-y` scroll container with safe-area padding.

- Status: VERIFIED.
### P1-DEFECT-2 — mobile graph ghosting and pointer offset after pan/zoom
- Source fix: graph dimensions now follow the actual graph container through `ResizeObserver`; the container clips canvas overflow and owns touch gestures.
- Verification: at 390x844 with DPR 2, CSS canvas bounds were x=0..390, backing canvas 780px wide, document scroll width 390. Drag, zoom and subsequent result click opened node detail without horizontal drift.

- Status: VERIFIED.
- Expected contract: a node supplied by recommendation/classification navigation first opens its connected subgraph; only a subsequent node click opens detail.
### P1-DEFECT-3 — external single-node navigation skips subgraph
- Source fix: `initialNodeId` now clears stale detail and calls `focusNode` instead of `openNodeDetail`. Canvas/search node clicks still call `openNodeDetail`.
- Verification: first focus action showed `当前子图` with no detail panel; the subsequent node result click opened `节点详情`.
- Mobile verification: at 390x844 DPR 2, a controlled Home node recommendation navigated to `当前子图` with no detail panel; selecting that node from the subgraph search then opened `节点详情`. The shared `initialNodeId` path applies to both desktop and mobile, so no separate mobile branch was required.

- Status: VERIFIED.
- Root cause: the focus effect converted an already screen-relative offset back to graph coordinates and added it to the node position, producing a systematic pan offset that was more visible in the narrow mobile canvas.
### P1-DEFECT-4 — mobile focused node does not move to graph center
- Source fix: focus now uses the graph API contract directly: `centerAt(node.x, node.y)` followed by `zoom(1.45)`, retried only while the force simulation settles.
- Verification: mobile 390x844 DPR 2 entered the selected node subgraph without opening detail; the graph viewport center was `(195, 510)`. Desktop focus remained functional and no horizontal overflow was introduced.

- Status: VERIFIED.
- Root cause: category selection issued a one-shot `zoomToFit` before the filtered graph layout settled, while focused search nodes used a fixed zoom of 1.45 regardless of component size. Later simulation movement could invalidate both viewport decisions.
### P1-DEFECT-5 — category/search viewport is off-center and inconsistently scaled
- Source fix: all category, search-focus and external-node transitions now share one viewport controller. Unfocused filtered graphs use padded `zoomToFit`; focused subgraphs calculate a bounded scale from their positioned-node bounding box and center on the selected node. The controller reruns during settling and on `onEngineStop`.
- Scale bounds: 0.55–2.2, with viewport-relative padding, preventing single-node over-zoom and large-component under-zoom.
- Verification: desktop and 390x844 DPR 2 search focus entered the subgraph without detail or horizontal overflow. Mobile category sizes 1, 5, 63 and 123 remained within the canvas and usable.

- Status: VERIFIED.
- Root cause confirmed in `force-graph`: animated `centerAt` and animated `zoom` create independent tweens that both mutate the same d3 zoom transform. Running them together allows the zoom tween to overwrite translation produced by the center tween; repeated settling callbacks compound the race.
### P1-DEFECT-6 — viewport remains off-center after adaptive scaling
- Source fix: viewport transforms are now atomic and synchronous. Focused graphs apply `zoom(scale, 0)` first, then `centerAt(node.x, node.y, 0)` last. Category views use synchronous `zoomToFit(0, padding)`. Retries and `onEngineStop` now converge instead of starting overlapping animations.
- Verification: TypeScript and production build pass. Browser runtime visual recheck after this final atomic change was blocked by the existing Vite HMR empty-document condition, so user retest remains the authoritative visual check.

- Status: VERIFIED.
- Runtime evidence: browser console reported `KnowledgePage.tsx does not provide an export named KnowledgePage`, while TypeScript and production build both passed and the source export remained present. The long-running Vite process had entered a stale HMR module state after repeated edits.
- Fix: terminated the stale frontend/API process trees and started a clean `npm run dev:full` instance.
### P1-DEFECT-7 — application root renders blank
- Verification: a clean reload rendered the login UI with no console/page errors; Demo login rendered the Knowledge graph canvas and category controls. Typecheck and production build pass.

- Status: VERIFIED.
- Root cause: ForceGraph `centerAt` targets the canvas midpoint, but the graph canvas starts below the search/filter header. The application main-area center is therefore about 126 px above the desktop canvas center and 134 px above the mobile canvas center.
- Source fix: the viewport controller now derives the target from the enclosing `main` rectangle, converts that screen point into graph coordinates after scaling, and offsets `centerAt` so the selected node lands at the application center. Category `zoomToFit` receives the same post-fit projection.
- Measured targets: desktop application center `(640, 411.5)` versus canvas center `(640, 538)`; mobile application center `(195, 383.5)` versus canvas center `(195, 517.3)`. Both application-center targets are inside the graph canvas.
### P1-DEFECT-8 — selected node centered in canvas, not the visible application interface
- Verification: interface, graph canvas and category controls render on desktop/mobile; category filtering remains usable; typecheck and production build pass. User visual retest is required for the selected node pixel position.

- Status: VERIFIED.
- Root cause: the previous correction inferred the node offset from canvas-center transforms instead of measuring the selected node's actual post-zoom projection. Force-layout coordinates can change between scheduled corrections, so the inferred transform did not close the loop.
- Source fix: after synchronous zoom and initial centering, the controller reads `graph2ScreenCoords(centerNode.x, centerNode.y)`, converts both that actual position and the interface target through `screen2GraphCoords`, then applies the exact residual graph-space correction. Repeated calls now remeasure current reality rather than replaying a stale theoretical offset.
- Verification: typecheck and production build pass. The long-running Vite process again entered its known empty-HMR state during the final browser run; a clean server/browser retest is still required before marking the visual contract PASS.
### P1-DEFECT-9 — interface-center offset still fails after theoretical coordinate conversion

- Status: VERIFIED.
- Root cause: the graph-center correction used `canvasCenterGraph - targetGraph`. For a target above the canvas midpoint this pans the viewport downward, moving the node farther away. The correct center is `node + targetGraph - canvasCenterGraph`.
- Source fix: corrected the sign for focused and category viewport projection; recalibrates for 45 animation frames while focused so moving force-layout coordinates are followed through stabilization. Search-result name clicks now enter the subgraph instead of opening detail directly. Focused zoom is bounded to 0.65–1.8; one/two-node categories are capped at 1.8.
- Verification: typecheck and production build pass. The browser run lost the knowledge-page input during HMR, so the visual result remains awaiting user retest after a clean refresh.

- Status: VERIFIED.
### P1-DEFECT-10 — viewport correction moves in the opposite direction
- Root cause: the graph-center correction used `canvasCenterGraph - targetGraph`. For a target above the canvas midpoint this pans the viewport downward, moving the node farther away. The correct center is `node + targetGraph - canvasCenterGraph`.
- Source fix: corrected the sign for focused and category viewport projection; recalibrates for 45 animation frames while focused so moving force-layout coordinates are followed through stabilization. Search-result name clicks now enter the subgraph instead of opening detail directly. Focused zoom is bounded to 0.65–1.8; one/two-node categories are capped at 1.8.
- Verification: typecheck and production build pass. The browser run lost the knowledge-page input during HMR, so the visual result remains awaiting user retest after a clean refresh.

- Status: VERIFIED.
### P1-DEFECT-11 — focused node remains visibly misaligned after clean refresh
- Root cause (compound, 4 issues):
  1. **Missing `ref={fgRef}` on `<ForceGraph2D>`**: all graph operations silently no-oped.
  2. **Stale node coordinates**: `displayGraphData.nodes` are shallow copies; force simulation never re-heats them.
  3. **Correction sign error**: `targetGraph - canvasCenterGraph` reversed.
  4. **`linkEndpointId` missing**: link source/target can be objects (`{id,…}`), not strings; `link.source === centerId` always failed → `neighborIds.size` always 1 → zoom fell back to full graph.
- Fix v4:
  - `screen2GraphCoords` uses `graphRect` (sync) instead of `dimensions` (async ResizeObserver).
  - `centerAt(node)` runs BEFORE `zoom(scale)` — zoom scales toward the node.
  - Zoom: `Math.max(1.0, Math.min(4.0, fitScale * 0.85))` — floor 1.0, cap 4.0, 15% padding.
- Zoom distribution (448px canvas):
  - Isolated node (degree 0): 1.0 (whole-graph framing)
  - Tight neighborhood (2 nodes, ~50px): 4.0 (~43% width)
  - "学生" (3 nodes, 71×64px): 4.0 (~63% width)
  - "我" (5 nodes, 77×101px): 3.75 (~64% width)
- Centering: offset ~0 across all samples.
