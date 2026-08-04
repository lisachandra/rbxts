# Garden Scraps Showcase Gap Review

## Summary

`test/demo` is now a real playable prototype rather than a package checklist, but it is **not yet a comprehensive showcase** of all major `@lisachandra/*` package capabilities.

This document records:

- what the current demo already covers well,
- what is only lightly covered,
- what is still missing,
- and what should be prioritized next.

---

## Current demo concept

**Garden Scraps** is a small co-op garden maintenance game where players:

- collect resources,
- clear plots,
- plant seeds,
- water plants,
- harvest grown crops,
- and maintain a shared garden progress loop.

The demo is centered around Matter ECS with replicated component-driven UI.

---

## What the current demo covers well

### `@lisachandra/matter`

Strongly covered:

- custom component registration
- server/client/shared system structure
- builtin package bootstrap path
- component replication (`all`, `owner`)
- runtime adapters
- client React subscription bridge via `HookConnector` + `useComponentRecord`

### `@lisachandra/ui`

Covered clearly:

- `AppContext`
- `usePx`
- `useWorldToScreen`
- `VirtualScroller`
- hot reloader integration
- camera-sensitive UI using `@rbxts/pretty-react-hooks`
- component-record-driven HUD updates

### `@lisachandra/platform`

Covered partially but meaningfully:

- `bootstrap`
- document setup
- Centurion startup
- custom demo admin commands
- simple auth configuration

### `@lisachandra/core`

Covered partially:

- logger startup
- math/vector helper usage
- general utility usage in gameplay code

### Game-side architecture

Covered:

- a compact real gameplay loop
- replicated player-local UI state
- replicated global progress state
- world-space markers
- notifications and HUD driven from component state

---

## What is still missing or weak

### `@lisachandra/matter`

Still missing or too shallow:

- item/hotbar/inventory gameplay that uses the built-in item stack intentionally
- explicit showcase of hook suite beyond `useComponentRecord` bridge patterns
    - `useMessage`
    - `useStream`
    - `useMemo`
    - `useReducer`
    - `useChange`
    - `useThrottle`
- package runtime / package graph as a visible gameplay composition feature
- pipeline usage
- node-oriented gameplay
- stronger visible sound-system usage

### `@lisachandra/platform`

Still missing:

- teleporter
- richer document-driven settings or progression surfaced in UI
- stronger showcase of custom command typing/utility beyond a few commands
- broader centurion types/guards story

### `@lisachandra/core`

Still weak:

- schemas in a visible runtime path
- `string` / `type` utilities as intentional features
- `color`, `cframe`, `vfx` as visible gameplay-facing helpers
- store primitives as a first-class demo story

### `@lisachandra/ui`

Still missing:

- `useProperty`
- `usePropertyBinding`
- `useConstant`
- richer reusable UI patterns beyond the current HUD

### `@lisachandra/types`

Mostly implicit only:

- service-tree typing is used, but the showcase does not make that obvious
- type augmentation benefits are not intentionally demonstrated

### `@lisachandra/test`

Only lightly represented:

- there are tests,
- but the demo does not yet clearly showcase `@lisachandra/test` as a package feature area

---

## Architectural rough edges

### 1. Garden progress lookup in React

The current `GardenProgress` UI still depends on a helper that discovers the singleton progress entity from React. It works, but it is less clean than the component-record subscription story.

### 2. Marker labels still use instance attributes

HUD and notifications moved to replicated components, but marker labels are still stored on parts via attributes like `markerLabel`. That is acceptable for now, but it is not pure component-driven state end-to-end.

### 3. Client systems are still thin

The current client systems are still light compared to the server systems. Presentation and prompt logic should become more meaningful if the demo is meant to showcase more of the stack.

### 4. Gameplay polish is limited

The demo is currently a systems prototype with a playable loop, not yet a polished “small game.”

---

## Recommended next priorities

### Priority 1 — clean architecture gaps

1. Replace React-side singleton lookup with a cleaner subscription or resolved entity source
2. Decide whether marker labels should move from instance attributes to replicated components
3. Expand client systems so more gameplay presentation happens through actual systems

### Priority 2 — deepen package showcase value

1. Integrate actual Matter item/hotbar/inventory usage into the garden loop
2. Add visible VFX/sound paths using core + matter utilities
3. Expose a small document/settings panel in UI
4. Use `useProperty`, `usePropertyBinding`, and `useConstant` intentionally

### Priority 3 — broader package surface

1. Add one meaningful `useMessage` or `useStream` gameplay path
2. Add stronger centurion typing/utility usage
3. Add at least one visible type-augmentation-led workflow
4. Add one or two tests that intentionally showcase `@lisachandra/test`

---

## Bottom line

### Is the current demo real?

Yes.

### Is it a meaningful ECS/gameplay showcase?

Yes, mostly.

### Is it done as a broad package showcase?

No.

It currently proves the architecture works and demonstrates a real gameplay loop, but there is still substantial package surface left uncovered or only implicitly represented.
