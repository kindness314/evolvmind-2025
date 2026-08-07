# Quality Guidelines

> Required correctness, security and verification standards for EvolvMind frontend work.

---

## Overview

Quality is defined by observable behavior across the state-managed React frontend, Vercel APIs and Supabase boundaries. The project currently has typecheck and production-build gates but no established automated unit/E2E test suite. Every behavioral change therefore requires the focused command or manual scenario that exercises the changed contract.

---

## Forbidden Patterns

- Do not add `react-router` or traditional URL routing. Navigation belongs to `App.tsx` state.
- Do not call MiniMax or another LLM provider directly from the frontend.
- Do not expose `MINIMAX_API_KEY` through a `VITE_` variable or browser response.
- Do not modify database schema through the Supabase Dashboard; create a migration.
- Do not bypass RLS with a service-role key from browser code.
- Do not trust request-body `user_id` or `scope_id` as authorization.
- Do not silently drop captured content when AI extraction, graph processing or JSON repair fails.
- Do not show service failure as an ordinary empty result.
- Do not add `any`, unchecked provider JSON assertions, or placeholder fallback data to delivered behavior.
- Do not remove or alter demo shared-scope behavior as incidental cleanup.

---

## Required Patterns

- Use Tailwind CSS 4 for static styling and Motion for page transitions/micro-interactions; inline styles are limited to genuinely dynamic values.
- Use Radix/shadcn-style primitives from `src/app/components/ui/` for standard interactive controls.
- Define explicit interfaces/types for API responses, Supabase payloads and component props.
- Surface loading, success, empty, fallback and error states where they differ to the user.
- Use Sonner for non-blocking user-visible errors in new work. Existing `alert()` calls are historical behavior, not the preferred pattern to copy.
- Keep capture non-blocking after raw data is safely stored; background graph work must report its status without destroying the raw record.
- Enforce allowed upload formats and a strict 10 MB maximum before Supabase Storage upload.
- Apply database changes through `supabase/migrations/YYYYMMDDHHMMSS_description.sql` and `supabase db push`.
- Preserve demo scope and authenticated-user isolation. Review every query for scope/RLS assumptions.
- When AI parsing is added, document mock input/output and use robust tail-object repair for `<think>` and markdown-fenced responses.

---

## Testing Requirements

Minimum verification for changed frontend or shared TypeScript code:

```bash
npm run typecheck
npm run build
```

Then run the smallest behavioral scenario covering the change. Examples:

- Full local stack: `npm run dev:full`, open `http://127.0.0.1:5173/`.
- Capture changes: save a supported input, confirm immediate result state, background graph status and preserved raw content on AI failure.
- Graph changes: open a real node, inspect details, open a source item, return, and confirm filters/focus remain intact.
- Search changes: verify success, no-results, provider-failure and local-fallback states separately.
- API changes: exercise the relevant endpoint with a valid request, invalid method/input and expected external-service error.
- Upload changes: test an allowed file, an unsupported file and a file larger than 10 MB before upload begins.

Do not claim semantic-search end-to-end success while the configured embedding provider returns `ModelNotAllowed`; only the UI and local fallback can be verified under that condition.

When adding tests, defend observable contracts and plausible failures rather than checking source text or implementation details.

---

## Code Review Checklist

### Architecture

- Does navigation continue through `App.tsx` without a second router?
- Is reusable logic placed in the existing `src/lib` or `ui` layer rather than duplicated?
- Is an unrelated feature-directory migration avoided?

### Type and error boundaries

- Are props, request bodies, responses and database rows explicit?
- Is untrusted JSON validated before use?
- Are loading, empty, fallback and error states distinguishable?
- Can an async effect update state after cancellation?

### Security and data isolation

- Are provider secrets server-only?
- Does the query respect authenticated/demo scope and RLS?
- Does a schema or policy change have a migration?
- Is upload size/type validation enforced before network work?

### UX and accessibility

- Are Radix/native semantics preserved?
- Do icon-only controls have accessible names?
- Are mobile and desktop layouts usable?
- Does closing a modal/panel preserve unrelated state?

### Verification

- Did `npm run typecheck` pass?
- Did `npm run build` pass?
- Was the specific changed behavior exercised with real success and failure states?

---

## Current Known Risks

- Semantic embedding is externally blocked by the current MiniMax key's `/embeddings` permission.
- Supabase Realtime behavior is intended but not currently implemented in `src/`.
- Several large page components contain substantial inline business logic; modularization is future focused work, not a bootstrap rewrite.
- Existing pages still use some `alert()` calls and inline styling. New work should use Sonner and Tailwind where practical without mixing unrelated cleanup into a feature change.
