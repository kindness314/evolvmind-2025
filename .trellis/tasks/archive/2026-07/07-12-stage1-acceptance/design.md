# Stage 1 Acceptance Design

## Boundaries

The task validates and minimally repairs the existing Stage 1 frontend/API flow. It does not redesign routing, graph storage, authentication, recommendation generation or summary generation.

## Navigation Contract

`App.tsx` remains the single page-state owner. Recommendation targets must use the existing `Page` values. If a node target needs focus/detail context, pass the node ID through the existing navigation callback contract and consume it in the Knowledge page without URL routing.

## Scope Contract

Browser-provided `scope_id` is selection input only for the explicit shared demo scope. For authenticated data, server handlers must obtain and verify the bearer token with Supabase Auth, derive the user ID from the verified session, and query with that user scope. No service-role query may trust an arbitrary authenticated request-body scope.

If the existing endpoint cannot distinguish demo from authenticated use safely, retain the current shared demo UUID only for requests explicitly marked as demo and reject invalid/missing authenticated credentials.

## Verification Shape

- Browser: demo login, Home, Knowledge, node details, source navigation, recommendation navigation.
- API: health behavior plus authenticated/demo scope branches and invalid-scope rejection where handlers change.
- Static: TypeScript typecheck and production build.

## Rollback

Navigation and scope fixes must be independent. If a scope repair breaks the existing demo flow, revert only that API change and keep the proven navigation fix; do not weaken authorization to make the demo pass.
