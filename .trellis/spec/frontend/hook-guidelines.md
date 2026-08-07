# Hook Guidelines

> How React hooks and asynchronous effects are currently used in EvolvMind.

---

## Overview

The frontend uses React's built-in hooks directly. There is no React Query, SWR, Redux, Zustand, or general application Context layer. Shared network operations are plain typed async functions in `src/lib`, not custom data-fetching hooks.

The only current reusable custom hook is `useIsMobile` in `src/app/components/ui/use-mobile.ts`.

---

## Custom Hook Patterns

Create a custom hook only when stateful behavior is genuinely reused or when extracting it makes a complex component boundary clearer. A hook must:

- start with `use`;
- expose a typed, minimal return contract;
- contain its own effect cleanup;
- avoid hiding navigation or unrelated application state;
- remain browser-side and never access server-only credentials.

Existing example:

```tsx
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    media.addEventListener("change", onChange);
    onChange();
    return () => media.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
```

Do not convert every page handler into a hook. Most page-specific state currently remains inside its owning component.

---

## Data Fetching

- Use `useEffect` for data tied to the mounted page or an input ID. `ItemDetailPage.tsx` reloads when `itemId` changes.
- Use explicit loading, error and data state. Render each state deliberately.
- Prevent stale async results from updating an unmounted or superseded component. Existing pages use a local `cancelled` flag returned from the effect cleanup.
- Use `useCallback` for async actions passed into effects or children when referential stability matters. `HomePage.tsx` and `KnowledgePage.tsx` contain current examples.
- Put reusable `/api/*` calls in `src/lib/*.ts`; examples are `fetchSummary`, `fetchRecommendations`, `semanticSearch`, and graph search functions.
- Direct Supabase queries are currently acceptable for page-local CRUD, as used in `HomePage.tsx` and `ItemDetailPage.tsx`. Reuse the singleton from `src/lib/supabase.ts` rather than creating another client unless maintaining an existing isolated path.
- Fire-and-forget background work must still handle rejection and update a visible status when the user depends on the result. Capture saving returns immediately while graph extraction continues.
- Supabase Realtime is part of the intended architecture, but the current frontend has no active `.channel(...).subscribe()` implementation. Do not claim realtime behavior exists without adding and verifying it.

---

## Hook Selection

- `useState`: local UI mode, form state, loading/error/data, selected IDs.
- `useEffect`: authentication checks, data loading, timers, media listeners and lifecycle cleanup.
- `useMemo`: expensive or multi-stage graph derivation; `KnowledgePage.tsx` is the main example.
- `useCallback`: reusable search, focus and async handlers whose identity is used by effects or child props.
- `useRef`: DOM handles, ForceGraph handles, debounce timers, and mutable cancellation/stop flags that must not trigger rendering.

Always list real dependencies. If an effect intentionally uses stable module-level values, make that clear in the structure rather than suppressing dependency problems through casts.

---

## Naming Conventions

- Custom hooks: `useThing` or `useThingState`.
- Event handlers: `handleSave`, `handleNodeClick`, `handleLogout`.
- Async loaders: `loadItems`, `fetchItemDetail`, `runSemanticSearch`.
- Boolean state: `isLoading`, `isSearching`, `isAuthenticated`, `hasMore`.
- Refs: suffix with `Ref`, such as `fileInputRef` and graph refs.

---

## Common Mistakes

- Starting asynchronous work in render.
- Omitting cleanup for timers, media listeners, subscriptions, or stale fetches.
- Creating a new Supabase client on each render.
- Using effects to mirror a value that can be derived with `useMemo`.
- Adding a global state library for state owned by one page or by `App.tsx`.
- Treating an API failure as `[]` and thereby showing “no results” instead of an error or fallback notice.
- Adding a realtime subscription without unsubscribing on cleanup or scoping it to the current user/demo scope.
