<h3 align="center">
    <br />
    rbxts
</h3>

<p align="center">
    Shared Roblox TypeScript packages for gameplay, ECS, UI, and platform integrations
</p>

<p align="center">
    <a href="https://github.com/lisachandra/rbxts/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
    <a href="https://www.npmjs.com/org/lisachandra"><img src="https://img.shields.io/badge/npm-@lisachandra-red" alt="npm @lisachandra" /></a>
</p>

---

`@lisachandra/rbxts` is a **pnpm monorepo** of reusable [roblox-ts](https://roblox-ts.com/) packages. It extracts shared gameplay systems, ECS patterns, UI components, and platform integrations from the game into versioned, publishable npm packages — so they can be composed across multiple Roblox games without copy-pasting.

> **Philosophy:** Build once, template everywhere. Each package exposes a stable API surface so games can pull in only what they need.

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@lisachandra/types`](packages/types) | [![npm](https://img.shields.io/npm/v/@lisachandra/types)](https://www.npmjs.com/package/@lisachandra/types) | Global type declarations for Roblox services and shared type augmentations |
| [`@lisachandra/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@lisachandra/core)](https://www.npmjs.com/package/@lisachandra/core) | Core runtime: logger, store, schemas, and utility modules (asset, cframe, color, math, string, type, vector, vfx, etc.) |
| [`@lisachandra/matter`](packages/matter) | [![npm](https://img.shields.io/npm/v/@lisachandra/matter)](https://www.npmjs.com/package/@lisachandra/matter) | ECS runtime built on `@rbxts/matter`: hooks, components, entity lookup, items, networking, packages, pipeline, and game systems |
| [`@lisachandra/ui`](packages/ui) | [![npm](https://img.shields.io/npm/v/@lisachandra/ui)](https://www.npmjs.com/package/@lisachandra/ui) | React UI components (`VirtualScroller`), hooks (`useWorldToScreen`, `usePx`, `useProperty`, `useConstant`), and hot reloader |
| [`@lisachandra/platform`](packages/platform) | [![npm](https://img.shields.io/npm/v/@lisachandra/platform)](https://www.npmjs.com/package/@lisachandra/platform) | Platform integrations: bootstrap (client/server startup), Centurion admin commands, document-based data, and teleporter |
| [`@lisachandra/test`](packages/test) | [![npm](https://img.shields.io/npm/v/@lisachandra/test)](https://www.npmjs.com/package/@lisachandra/test) | Test utilities and runtime helpers for Jest Roblox |

### Dependency Graph

```
types  ←  core  ←  matter  ←  platform
              ↖__ ui _____/
               test _____/
```

- [`@lisachandra/types`](packages/types) — leaf package, no internal dependencies
- [`@lisachandra/core`](packages/core) — depends on `types`
- [`@lisachandra/matter`](packages/matter) — depends on `core` + `types`
- [`@lisachandra/ui`](packages/ui) — depends on `core` + `types`
- [`@lisachandra/platform`](packages/platform) — depends on `matter` + `core` + `types`
- [`@lisachandra/test`](packages/test) — depends on `types`

## Installation

```bash
npm install @lisachandra/types
npm install @lisachandra/core
npm install @lisachandra/matter
npm install @lisachandra/ui
npm install @lisachandra/platform
npm install @lisachandra/test
```

All packages are published with **public access** and require their `peerDependencies` to be installed in the consuming project.

## Package Details

### `@lisachandra/types` — [packages/types](packages/types)

Global type augmentations for Roblox services (`Workspace`, `Players`, `ReplicatedStorage`, `SoundService`) and shared types used across packages. Re-exports Luau runtime types needed at compile time.

### `@lisachandra/core` — [packages/core](packages/core)

Core runtime primitives and utilities:

| Export | Description |
| --- | --- |
| `@lisachandra/core` | Main entry (re-exports all below) |
| `@lisachandra/core/logger` | Structured logging via `@rbxts/log` |
| `@lisachandra/core/store` | Reactive store primitive |
| `@lisachandra/core/schemas` | Character validation schemas (R6, R15, Humanoid) |
| `@lisachandra/core/utils/asset` | Asset ID resolution helpers |
| `@lisachandra/core/utils/cframe` | CFrame manipulation utilities |
| `@lisachandra/core/utils/color` | Color conversion and manipulation |
| `@lisachandra/core/utils/formatTable` | Table formatting (Luau) |
| `@lisachandra/core/utils/main` | General-purpose utility functions |
| `@lisachandra/core/utils/math` | Math helpers |
| `@lisachandra/core/utils/r6ik` | R6 inverse kinematics (Luau) |
| `@lisachandra/core/utils/string` | String manipulation utilities |
| `@lisachandra/core/utils/type` | Type guards and type utilities |
| `@lisachandra/core/utils/vector` | Vector math utilities |
| `@lisachandra/core/utils/vfx` | Visual effects helpers |

### `@lisachandra/matter` — [packages/matter](packages/matter)

The heart of the ECS. Built on top of `@rbxts/matter` with additional abstractions for composable game features.

| Export | Description |
| --- | --- |
| `@lisachandra/matter` | Main entry: components, hooks, network, items, packages, pipeline, entity lookup, phases, startup |
| `@lisachandra/matter/packages` | Package system for composable game features (plugin-like architecture with dependency resolution) |
| `@lisachandra/matter/items` | Item definitions, registry, serialization/deserialization (Serio-based), and type descriptions |
| `@lisachandra/matter/utils/item` | Item utility functions |
| `@lisachandra/matter/utils/entity` | Entity lookup and management utilities |
| `@lisachandra/matter/utils/physics` | Physics utilities (tweening, constraints, raycasting) |
| `@lisachandra/matter/utils/sound` | Sound playback and management utilities |

### `@lisachandra/ui` — [packages/ui](packages/ui)

React-based UI components and hooks for Roblox (`@rbxts/react`).

| Export | Description |
| --- | --- |
| `@lisachandra/ui` | Main entry: VirtualScroller, AppContext, hooks, hot reloader |

**Components:**
- `VirtualScroller` — Virtualized list rendering component

**Hooks:**
- `useWorldToScreen` / `projectWorldToScreen` — World-to-screen coordinate projection
- `usePx` / `computePx` — Pixel-density-aware measurements
- `useProperty` / `usePropertyBinding` — Instance property change observation
- `useConstant` — Stable constant references

**Other:**
- `AppContext` — Application context provider
- `createAppHotReloader` — Component hot-reloading for development

### `@lisachandra/test` — [packages/test](packages/test)

Test utilities and runtime helpers for Jest Roblox (`@rbxts/jest`). Provides Luau runtime utilities used by test suites across the monorepo.

### `@lisachandra/platform` — [packages/platform](packages/platform)

Runtime platform glue and integrations.

| Export | Description |
| --- | --- |
| `@lisachandra/platform` | Main entry: bootstrap, centurion utilities, teleporter |
| `@lisachandra/platform/bootstrap` | Client and server startup orchestration (Flamework + Matter initialization) |
| `@lisachandra/platform/centurion/type` | Centurion type definitions |
| `@lisachandra/platform/centurion/guards` | Type-safe argument guards for Centurion commands |
| `@lisachandra/platform/centurion/commands` | Admin commands (document, kick, set, teleport) |
| `@lisachandra/platform/centurion/types` | Custom Centurion argument types (entity) |
| `@lisachandra/platform/centurion/utility` | Centurion utility helpers (argument parsing, type builders) |
| `@lisachandra/platform/teleporter` | Player teleportation between places/servers |
| `@lisachandra/platform/document` | Document-based data with Lapis persistence and validation |

## License

[MIT](LICENSE.md)

---

**Owner:** [lisachandra](https://github.com/lisachandra) <lisachandra@proton.me>
