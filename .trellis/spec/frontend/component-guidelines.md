# Component Guidelines

> How React components are currently built in EvolvMind.

---

## Overview

The application uses React function components, TypeScript props interfaces, Tailwind CSS 4, Motion, and Radix-based UI primitives. Page components own substantial UI state today; do not invent a new component architecture in an unrelated change.

`App` is the root default export. Page components and UI primitives are normally named exports.

---

## Component Structure

A page component normally follows this order:

1. Imports.
2. Local interfaces and union types.
3. Module-level constants or animation variants.
4. Named function component.
5. Local state, refs, derived values and callbacks.
6. Effects.
7. Loading/error/empty or mode-specific early returns.
8. JSX.

```tsx
interface ItemDetailPageProps {
  itemId: string;
  onBack: () => void;
  onUpdate?: () => void;
}

export function ItemDetailPage({ itemId, onBack, onUpdate }: ItemDetailPageProps) {
  // state, effects, handlers, render
}
```

Use finite unions for page modes and process state instead of unrelated booleans where the states are mutually exclusive. Real examples include the page union in `src/app/App.tsx` and graph processing state in `src/app/components/CapturePage.tsx`.

---

## Props Conventions

- Define an explicit local `...Props` interface for page components.
- Use callback props for navigation and parent-owned events: `onNavigate`, `onBack`, `onUpdate`, `onLogout`, `onLoginSuccess`.
- Keep callbacks typed with their exact arguments. Do not pass loosely typed event bags.
- Keep cross-page selected IDs in `App.tsx` when a destination page needs them, as with item details and knowledge-node focus.
- For reusable primitives, extend the native or Radix primitive props. `src/app/components/ui/button.tsx` uses `React.ComponentProps<'button'>` with CVA variant types; `dialog.tsx` wraps `React.ComponentProps<typeof DialogPrimitive.Root>`.
- Forward `className` and merge it with defaults through `cn()`.

---

## Composition and UI Primitives

- Reuse components from `src/app/components/ui/` for standard controls and overlays.
- New base primitives belong in that directory and should follow the shadcn-style pattern: Radix for behavior, Tailwind for presentation, named compound exports where appropriate.
- Use `data-slot` and Radix `data-[state=*]` attributes when matching the existing primitive style.
- Keep domain-specific cards and panels in their page until they are reused by more than one feature; avoid premature extraction.

Canonical examples:

- `src/app/components/ui/button.tsx` — CVA variants, `Slot`, typed native props.
- `src/app/components/ui/dialog.tsx` — compound Radix wrapper with portal, overlay and accessible close label.
- `src/app/components/ui/card.tsx` — named compound sections with native div props.

---

## Styling Patterns

- Use Tailwind CSS 4 utility classes for layout, colors, responsive states and interaction states.
- Use the `cn()` helper from `src/app/components/ui/utils.ts` for conditional class merging.
- Use theme tokens from `src/styles/theme.css` instead of introducing isolated color systems.
- Avoid `style={{ ... }}` unless the value is genuinely calculated at runtime, such as graph canvas positioning or dynamic dimensions.
- The current app is mobile-first and often uses `max-w-md`, with `md:` variants for desktop adaptations such as the knowledge detail panel.
- Use `motion` from `motion/react` for page transitions and micro-interactions. `App.tsx`, `LoginPage.tsx`, `CapturePage.tsx`, and `KnowledgePage.tsx` are current examples. Use `AnimatePresence` when mounting and unmounting animated UI.

---

## Accessibility

- Prefer Radix primitives for dialogs, menus, switches and overlays because they provide keyboard and focus behavior.
- Preserve semantic native controls and labels. Icon-only buttons need an accessible label or visually hidden text; `ui/dialog.tsx` uses an `sr-only` close label.
- Keep visible loading, empty and error states. Do not leave a blank panel while async work runs or fails.
- Do not encode essential meaning only through animation or color.
- Verify interactive controls remain usable on mobile and at the existing desktop breakpoint.

---

## Common Mistakes

- Adding `react-router` or links as a second navigation system instead of extending `App.tsx`.
- Importing Radix primitives directly into feature pages when a project wrapper already exists.
- Using `any` for props, API data or graph entities.
- Adding fixed inline styles for values that Tailwind already expresses.
- Showing provider or database failures as an empty state.
- Clearing unrelated page state when closing a panel; for example, closing node details must not reset graph filtering or focus.

---

## Real Examples

- `src/app/App.tsx` — root composition, typed page state and Motion page transitions.
- `src/app/components/LoginPage.tsx` — step-based UI and `AnimatePresence` transitions.
- `src/app/components/KnowledgePage.tsx` — responsive graph/detail composition and Sonner error feedback.
- `src/app/components/SettingsPage.tsx` — reuse of the local `Switch` primitive.
