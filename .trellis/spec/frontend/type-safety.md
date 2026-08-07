# Type Safety

> TypeScript and runtime-boundary conventions for EvolvMind.

---

## Overview

The project uses TypeScript strict mode (`tsconfig.json`) and `npm run typecheck` (`tsc --noEmit`). Explicit types are required at API, database and component boundaries. Inference is preferred for simple local expressions, but external data must not flow through the application as `any`.

---

## Type Organization

- Keep page-only props and UI data interfaces near the component that owns them.
- Keep shared frontend request/response types in the corresponding `src/lib` client module.
- Keep domain unions explicit. Examples include the `Page` union in `App.tsx`, graph node/link kinds in `src/lib/graph.ts`, and recommendation target/type unions in `src/lib/recommend.ts`.
- API handlers define explicit request bodies, rows, response payloads and provider payloads. Do not pass untyped Supabase or LLM responses directly to the client.
- Prefer named interfaces for object shapes and string unions for closed states.
- Use `unknown` for caught errors or untrusted JSON until narrowed.

Real examples:

- `src/lib/search.ts` — `SearchResult` and `SearchResponse` define the browser API contract.
- `src/lib/summarize.ts` — explicit summary theme, node, connection and response types.
- `src/app/components/CapturePage.tsx` — explicit `CaptureMode`, saved-item and graph-process types.
- `api/graph/extract.ts` — explicit extracted graph node/link payloads.

---

## Runtime Validation

The repository does not currently use Zod, Yup or another schema library. Runtime validation is manual and must remain explicit at trust boundaries:

- validate HTTP methods and required request fields in API handlers;
- validate `response.ok` before reading a response as success;
- check array/object/string/number shape before using provider JSON;
- check Supabase errors after every query or RPC;
- validate file type and the 10 MB limit before upload;
- narrow caught errors with `error instanceof Error` before reading `.message`.

LLM output is untrusted. It may contain `<think>` blocks, markdown fences, commentary or multiple JSON objects. Use the established JSON repair approach represented by `safeJsonParse`, `extractJsonObjects`, and `normalizeContentToJson` in `src/lib/ai.ts`: strip wrappers, inspect candidate objects from the tail, validate the resulting shape, and return a visible unstructured/error state if repair fails. Never crash or silently discard captured content.

When adding a new AI extraction/parsing pattern, add a mock input/output comment block at the top of the relevant library file.

---

## Common Patterns

```ts
type GraphProcessStatus = "idle" | "processing" | "done" | "error";

interface SearchResponse {
  results: SearchResult[];
  fallback?: boolean;
  message?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
```

- Use discriminating fields or finite status unions for async state machines.
- Use optional fields only when absence is a valid contract state.
- Normalize nullable database fields at one boundary rather than scattering assertions across JSX.
- Use type guards and `Array.isArray` for untrusted JSON.
- Keep IDs as strings and timestamps as serialized strings at transport boundaries unless a component explicitly converts them to `Date`.

---

## Forbidden Patterns

- `any` for API responses, database payloads, component props or graph entities.
- Blind `as SomeType` assertions on `await response.json()` or LLM output without validation.
- Non-null assertions on environment variables, selected IDs or Supabase rows unless the same function has already proven the invariant.
- Exposing `MINIMAX_API_KEY` or any provider credential through a `VITE_` variable or frontend type.
- Treating malformed AI JSON as an impossible state.
- Returning a success-shaped empty array for a provider, authorization or database failure.

---

## Existing Debt to Preserve, Not Copy

Some domain and Vercel request/response types are duplicated between API files and frontend modules, and several JSON-repair implementations overlap. Bootstrap documentation records this reality; do not add another duplicate casually. Consolidation requires a focused task that preserves server/client bundling boundaries and verifies all callers.
