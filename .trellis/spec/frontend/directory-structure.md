# Directory Structure

> The current frontend organization and placement rules for EvolvMind.

---

## Overview

EvolvMind is a Vite + React single-page application. The current structure is intentionally flat: page components live together, reusable UI primitives live in a dedicated `ui` directory, and shared business operations live in `src/lib`.

The repository does not currently use `src/features/*`. `README.md` describes that directory as a future incremental refactor, not an existing convention. Do not introduce a broad feature-directory migration as part of an unrelated change.

---

## Directory Layout

```text
src/
├── main.tsx                       # React DOM entry and global stylesheet import
├── app/
│   ├── App.tsx                    # Authentication gate and state-driven page navigation
│   └── components/
│       ├── HomePage.tsx           # Page-level components are currently flat
│       ├── CapturePage.tsx
│       ├── KnowledgePage.tsx
│       ├── ItemDetailPage.tsx
│       ├── LoginPage.tsx
│       ├── ProcessPage.tsx
│       ├── SettingsPage.tsx
│       ├── figma/                 # Figma-originated compatibility helpers
│       └── ui/                    # Reusable Radix/shadcn-style primitives
├── lib/                           # Shared Supabase, API-client, AI and graph logic
└── styles/                        # Tailwind entry, theme tokens and global styles

api/
├── _lib/                          # Code shared by serverless functions
├── graph/                         # Knowledge-graph serverless endpoints
└── *.ts                           # Vercel serverless endpoints

supabase/migrations/               # Versioned schema, function and RLS changes
utils/supabase/                    # Existing Supabase project configuration helper
```

---

## Module Organization

- Put a new page-level component in `src/app/components/` and export it by name. Existing examples: `HomePage`, `CapturePage`, and `KnowledgePage`.
- Register a new page in `src/app/App.tsx`: extend the local `Page` union, add it to the render switch, and pass typed callbacks or selected IDs as props. Do not add `react-router` or URL routing.
- Put a new reusable base component in `src/app/components/ui/`. Follow the existing Radix/shadcn wrapper pattern rather than embedding a second primitive system in a page.
- Put browser-side business operations and typed `/api/*` clients in `src/lib/`. Examples: `src/lib/search.ts`, `src/lib/recommend.ts`, and `src/lib/graph.ts`.
- Put Vercel handlers in `api/`; graph-specific endpoints belong in `api/graph/`. Shared server-only code belongs in `api/_lib/`.
- Create database changes only as timestamped SQL files under `supabase/migrations/`; never make schema changes through the Supabase Dashboard.
- Large modules such as `KnowledgePage.tsx` and `src/lib/graph.ts` may be moved gradually into `src/features/*` only in an explicit modularization task with full call-site migration and behavioral verification.

---

## Naming Conventions

- Page and React component files use PascalCase: `CapturePage.tsx`, `ItemDetailPage.tsx`.
- UI primitive files use kebab-case: `alert-dialog.tsx`, `toggle-group.tsx`, `use-mobile.ts`.
- Shared library files use concise camelCase or domain nouns: `graphSearch.ts`, `summarize.ts`, `supabase.ts`.
- React components and interfaces use PascalCase. Functions, callbacks and state variables use camelCase.
- Custom hooks must start with `use`; the existing example is `useIsMobile` in `src/app/components/ui/use-mobile.ts`.
- Migration files use `YYYYMMDDHHMMSS_description.sql`.

---

## Examples

- `src/app/App.tsx` — central page union, navigation state, auth gate and page rendering.
- `src/app/components/ui/button.tsx` — canonical reusable UI primitive with variants and typed native props.
- `src/lib/search.ts` — typed frontend API client kept outside the page component.
- `api/_lib/embedding.ts` — server-only logic shared between API handlers.

---

## Avoid

- Do not create a second routing convention beside `App.tsx` state navigation.
- Do not place server secrets or provider calls in `src/`.
- Do not duplicate a reusable Radix primitive inside a page when `src/app/components/ui/` already provides it.
- Do not perform a repository-wide directory migration while implementing a small feature.
