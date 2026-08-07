# Knowledge Graph — Focus & Zoom: Pending Fixes

Created: 2026-07-13
Source: `src/app/components/KnowledgePage.tsx` — `positionGraphViewport()` and related hooks.

## Current State (v4, 2026-07-13)

Zoom formula: `Math.max(1.0, Math.min(4.0, fitScale * 0.85))`

| Parameter | Value |
|-----------|-------|
| Floor | 1.0 |
| Cap | 4.0 |
| Padding factor | 0.85 |
| Centering basis | `graphRect` (sync `getBoundingClientRect`) |
| Execution order | `centerAt` → `zoom` |
| Node coordinates | `fg.getGraphBbox(fn)` from live simulation |
| Neighborhood lookup | `linkEndpointId()` for safe source/target ID extraction |

## Root Problem

The **linear `fitScale` formula** (`fitScale = canvasSize / bboxSize`) does not scale well across the wide range of neighborhood sizes (48px to 1200px+):

- **Tight clusters** (2–3 nodes within ~50px): fitScale hits the cap (4.0), but 4.0 only shows ~200px on a 448px canvas — still small relative to the canvas.
- **Wide neighborhoods** (10+ loosely connected nodes, 500px+): fitScale drops below 1.0, floored at 1.0 — shows the neighborhood at 1:1, way too small.

**User feedback**: "有的有点太大了" (some too big), "有的还是太小" (some still too small). The current cap/floor approach cannot satisfy both ends simultaneously.

## Specific Defects

### 1. Zoom strategy: linear fitScale is not perception-aware
- **Expected**: Zoom should make the focused neighborhood comfortably fill 40–70% of canvas, regardless of neighborhood size.
- **Observed**: Cap/floor clamping produces extremes — 4.0 for tiny clusters (fills ~40% at best) vs 1.0 for large ones (fills ~10%).
- **Potential fix**: Non-linear scaling — e.g. `Math.sqrt(fitScale) * baseZoom`, or logarithmic mapping. Or per-node zoom presets computed from neighborhood density.
- **File**: `KnowledgePage.tsx` lines ~545–556

### 2. Centering: no awareness of node label/pane overlap
- **Expected**: The focused node should be placed so that its label and any open detail pane don't overlap the viewport edges.
- **Observed**: Node is centered at the `<main>` center, but when the detail pane is open on the right, the graph area shrinks and the node may be clipped.
- **Potential fix**: Adjust target center based on whether detail pane is open (`selectedNodeIds.length > 0`).

### 3. Category view: zoomToFit may clip long labels
- **Expected**: Category view should show all nodes with readable labels.
- **Observed**: `zoomToFit` fits the bbox but doesn't account for label overflow.
- **Potential fix**: Add label-hull padding to `zoomToFit` bounds.

### 4. Mobile: zoom may feel different due to smaller canvas
- **Expected**: Zoom behavior should feel equivalent on mobile (390×844) and desktop (1280×900).
- **Observed**: Same zoom formula applied to different canvas sizes — a 4.0 zoom on a 390px-wide screen feels different from 4.0 on a 448px-wide desktop.
- **Potential fix**: Scale zoom relative to viewport width.

## Proposed Approach (future iteration)

Instead of fitting to bbox with a linear scale and hard cap/floor, try:

1. **Target fill ratio**: Aim for the neighborhood to fill ~50% of the canvas width.
2. **Non-linear mapping**: `targetZoom = clamp(log2(fitScale + 1) * baseFactor, floor, cap)` — log compresses the wide range.
3. **Per-node presets**: Compute `optimalZoom` for each node (based on neighborhood density) at graph load time, store in graph data, and interpolate on focus.

## Verification Notes

- Any change to `positionGraphViewport` MUST be programmatically tested across ≥5 nodes spanning the degree distribution.
- Category view centering MUST remain at `offset ~0`.
- Build MUST pass (`npm run build`).
