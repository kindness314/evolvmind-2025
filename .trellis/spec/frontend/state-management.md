# State Management

> The current state ownership and synchronization model in EvolvMind.

---

## Overview

EvolvMind uses React local state and explicit prop callbacks. It has no application-wide state library and no URL router. `src/app/App.tsx` owns authentication and page navigation; each page owns its own view, form and request state.

Supabase remains the persistent source of truth. Frontend state is a view of that data, not a replacement for it.

---

## State Categories

### Root application state

`App.tsx` owns state needed across page boundaries:

- current page (`Page` union);
- authentication/checking state;
- selected content ID for `ItemDetailPage`;
- navigation callbacks passed to pages.

Navigation is state-driven. To add a page, extend the `Page` union and render switch in `App.tsx`. Do not introduce `react-router`, URL parameters, or another page registry.

### Page-local UI state

Keep state in the page that owns it:

- `CapturePage.tsx`: capture mode, form data, saved result and graph-processing status;
- `HomePage.tsx`: list, selection, search, summary and recommendations;
- `KnowledgePage.tsx`: filters, graph focus, selected detail node and panel state;
- `SettingsPage.tsx`: backfill progress and stop flags.

Do not lift state merely because it has several fields. Lift it when another page or the root must control or preserve it.

### Derived state

Compute values from canonical state instead of synchronizing duplicates. Use `useMemo` when the computation is non-trivial, especially for graph node/edge filtering, connected components, time ranges and search highlighting in `KnowledgePage.tsx`.

### Mutable non-render state

Use refs for values that must persist without causing a render: DOM inputs, graph instances, timers and stop/cancellation flags.

### Persistent browser state

`localStorage.demo_auth === 'true'` is the existing demo-mode switch. Do not add unrelated durable application state to local storage without a product requirement and an expiry/migration decision.

---

## When to Use Global State

There is currently no global state store. Prefer, in order:

1. local component state;
2. lifting state to the nearest shared owner;
3. a typed callback or selected ID in `App.tsx` for cross-page navigation;
4. Supabase for durable server state.

Introduce Context or a state library only through an explicit architecture task demonstrating repeated prop threading or shared mutable state that the current pattern cannot manage cleanly.

---

## Server State

- Use the singleton Supabase client exported by `src/lib/supabase.ts` for browser access.
- Use typed functions in `src/lib` for Vercel API calls and shared request behavior.
- Track loading, error, empty, success and fallback states separately where they have different user meaning.
- Do not optimistically claim durable success before Supabase confirms the write.
- The capture flow deliberately saves raw content first, returns the user to a useful state, and runs graph extraction in the background. Preserve the raw record even if AI parsing fails.
- Semantic search may fall back to local matching when embedding is unavailable, but the UI must disclose the fallback instead of representing it as a semantic result.
- Any future Realtime subscription must be scoped to the current authenticated user or the existing demo scope and must unsubscribe during effect cleanup.

---

## Scope and Demo Mode

- Authenticated data uses the authenticated user's scope.
- Demo mode uses `user_id = null` and the fallback scope UUID `00000000-0000-0000-0000-000000000000` for graph merging and deduplication.
- Demo data is shared. Do not change this behavior or its RLS implications in a frontend-only change.
- Scope, RLS and storage-policy changes require a Supabase migration and explicit product/security review.

---

## Common Mistakes

- Adding URL routing beside the `Page` union.
- Duplicating server records in multiple independent state variables that drift apart.
- Resetting graph filters or focus when only a details panel closes.
- Using one boolean to represent loading, empty, external-service failure and fallback.
- Trusting a request-body `user_id` or `scope_id` as authorization.
- Updating state after an effect has been cancelled.
- Adding a global store for a single page's form or modal state.
