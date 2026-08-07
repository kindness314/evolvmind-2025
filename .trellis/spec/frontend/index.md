# Frontend Development Guidelines

> Project-specific frontend conventions for EvolvMind.

---

## Overview

EvolvMind is a React 18 + TypeScript + Vite single-page application backed by Supabase and Vercel Serverless Functions. Navigation is state-driven in `src/app/App.tsx`; styling uses Tailwind CSS 4; reusable primitives follow the Radix/shadcn pattern; animations use Motion.

These files document the repository's current conventions. They are injected into Trellis implementation and review contexts when referenced by a task manifest.

---

## Pre-Development Checklist

Before changing frontend code:

- Read the task PRD and the relevant guide below.
- Confirm whether the change belongs in a page, `src/lib`, `src/app/components/ui`, `api`, or a Supabase migration.
- Trace navigation through the `Page` union and render switch in `App.tsx`; do not add a URL router.
- Check existing UI primitives before creating another control.
- Identify authenticated versus demo scope and all RLS/security implications.
- Define explicit request, response, database and props types.
- Plan loading, success, empty, fallback and error behavior.
- For uploads, enforce supported formats and the 10 MB frontend limit.
- For AI output, plan `<think>`/markdown JSON repair and a visible unstructured fallback.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Current page, UI, library, API and migration placement | Complete |
| [Component Guidelines](./component-guidelines.md) | React props, composition, Tailwind, Motion and accessibility | Complete |
| [Hook Guidelines](./hook-guidelines.md) | Built-in hooks, async cleanup and custom-hook boundaries | Complete |
| [State Management](./state-management.md) | State-driven navigation, page ownership and Supabase state | Complete |
| [Quality Guidelines](./quality-guidelines.md) | Security, forbidden patterns and verification gates | Complete |
| [Type Safety](./type-safety.md) | Strict TypeScript and runtime-boundary validation | Complete |

Cross-layer decisions should also consult `../guides/cross-layer-thinking-guide.md` and reuse decisions should consult `../guides/code-reuse-thinking-guide.md`.

---

## Quality Check

Before completing frontend work:

- Verify every changed API/data boundary is explicitly typed and validates untrusted data.
- Verify no provider secret or service-role credential can reach the browser.
- Verify authenticated/demo queries preserve scope and RLS assumptions.
- Verify navigation remains state-based and mobile/desktop interactions still work.
- Verify loading, empty, fallback and error states independently.
- Run `npm run typecheck` and `npm run build`.
- Exercise the focused user scenario with the local stack when behavior changed.
- If code changed, refresh `.codegraph/graph.json` with `npx @zabaca/codegraph update` when the project wants the checked-in/local map current.

---

## Canonical Examples

- `src/app/App.tsx` — state-managed navigation and page transitions.
- `src/app/components/ui/button.tsx` — reusable typed UI primitive.
- `src/app/components/KnowledgePage.tsx` — derived graph state and responsive details UI.
- `src/lib/ai.ts` — defensive LLM JSON normalization.
- `src/lib/search.ts` — typed frontend API client.
- `api/_lib/embedding.ts` — shared server-only provider integration.

---

**Language**: Trellis project documentation is written in English.
