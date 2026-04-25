---
name: performance
description: Performance optimization guidelines for React in the Godkin project, adapted from Vercel best practices for roblox-ts.
---

# React Performance Optimization

## Eliminating Waterfalls
- **`async-parallel`**: Use `Promise.all()` for independent operations to avoid sequential waiting.
- **`async-defer-await`**: Move `await` into branches where the data is actually used.

## Re-render Optimization
- **`rerender-memo`**: Extract expensive work into memoized components using `React.memo`.
- **`rerender-dependencies`**: Use primitive dependencies in `useEffect`, `useMemo`, and `useCallback` to avoid unnecessary triggers.
- **`rerender-derived-state`**: Derive state during render, not in effects.
- **`rerender-functional-setstate`**: Use functional `setState` (e.g., `setCount(c => c + 1)`) for stable callbacks.
- **`rerender-lazy-state-init`**: Pass a function to `useState` for expensive initial values.
- **`rerender-use-ref-transient-values`**: Use refs for transient, frequently changing values that don't need to trigger a re-render.
- **`rerender-defer-reads`**: Don't subscribe to state only used in callbacks.

## Rendering Performance
- **`rendering-conditional-render`**: Use ternary operators (`condition ? <A /> : <B />`) instead of `&&` to avoid unexpected `0` or `false` rendering in Luau.
- **`rendering-hoist-jsx`**: Extract static JSX outside of components to avoid re-creation on every render.
- **`rendering-activity`**: Use an `Activity` component or similar for show/hide logic instead of unmounting if the component is expensive to re-mount.

## Godkin-Specific Patterns
- **`px` Scaling**: Use `usePx` and `AppContext` for consistent scaling. Avoid recalculating `px` values in render; use bindings or memoization.
- **`react-template`**: Templates are efficient as they reuse existing Roblox instances. Use `Tag` for efficient element lookup in tests.
- **XState**: Use `snapshot.matches()` for efficient state checks. Avoid deep context reads if only a small part of the context is needed.

## JavaScript Performance (Luau)
- **`js-early-exit`**: Return early from functions to reduce nesting and improve readability.
- **`js-index-maps`**: Build a Map/Table for repeated lookups instead of searching arrays.
- **`js-cache-property-access`**: Cache object properties in loops if accessed multiple times.

## Bundle Size & Loading
- **`bundle-barrel-imports`**: Avoid large barrel files (`index.ts`) that re-export everything, as they can lead to unnecessary code being included in the bundle. Import directly from the source file when possible.

## Advanced Patterns
- **`advanced-event-handler-refs`**: Store event handlers in refs to keep callbacks stable.
- **`advanced-init-once`**: Initialize app-wide resources once per app load.
- **`advanced-use-latest`**: Use a `useLatest` hook for stable callback refs.
