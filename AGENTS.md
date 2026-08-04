# AGENTS.md — rbxts

## Project Overview

**`rbxts`** is a pnpm monorepo of reusable Roblox TypeScript packages created by **lisachandra**. The primary goal is to extract shared gameplay systems, UI components, and platform integrations from the game into versioned, publishable npm packages — so they can be composed across multiple Roblox games without copy-pasting.

> **Philosophy:** Build once, template everywhere. Each package exposes a stable API surface so games can pull in only what they need.

---

## Repository Structure

```
rbxts/
├── packages/
│   ├── types/          @lisachandra/types      — Global type declarations
│   ├── core/           @lisachandra/core       — Utilities, logger, store, schemas
│   ├── matter/         @lisachandra/matter     — ECS runtime (Matter), hooks, systems, items, replication
│   ├── ui/             @lisachandra/ui         — React UI components and hooks
│   ├── platform/       @lisachandra/platform   — Bootstrap, centurion commands, documents, teleporter
│   ├── react-template/ @lisachandra/react-template — Instance → React component generator
│   ├── react-router/   @lisachandra/react-router   — Client-side router for React Roblox
│   ├── test/           @lisachandra/test       — Test utilities and runtime helpers
│   └── sandcastle/     @lisachandra/sandcastle — Agent issue runner (Node dev tooling)
├── test/               Per-package test suites and shared Jest config (test/<name>/)
├── scripts/            Build and hoisting scripts
├── docs/               Additional documentation
├── pnpm-workspace.yaml
├── tsconfig.json       Base tsconfig extending @isentinel/tsconfig/roblox
└── package.json        Root scripts (build, dev, release)
```

### Dependency Graph (simplified)

```
types  ←  core  ←  matter  ←  platform
              ↖__ ui _______/
                   test ____/

react-template  ← types
react-router    ← types
sandcastle      (standalone Node tooling, no workspace deps)
```

- **types** has no internal dependencies (leaf package)
- **core** depends on types
- **matter** depends on core + types
- **ui** depends on core + matter + react-template + types
- **platform** depends on matter + core + types
- **test** depends on types
- **react-template** depends on types
- **react-router** depends on types
- **sandcastle** has no workspace dependencies (Node-side CLI for the agent issue workflow)

---

## Package Descriptions

### `@lisachandra/types`

Global type augmentations for Roblox services (`Workspace`, `Players`, `ReplicatedStorage`, `SoundService`) and shared types used across packages. Also re-exports Luau types needed at runtime.

### `@lisachandra/core`

Core runtime primitives:

- **`/logger`** — Structured logging via `@rbxts/log`
- **`/store`** — Reactive store primitive
- **`/schemas`** — Character validation schemas (R6, R15, Humanoid)
- **`/utils/asset`** — Asset ID resolution
- **`/utils/cframe`** — CFrame helpers
- **`/utils/color`** — Color utilities
- **`/utils/formatTable`** — Table formatting (Luau)
- **`/utils/main`** — General-purpose utilities
- **`/utils/math`** — Math helpers
- **`/utils/r6ik`** — R6 inverse kinematics (Luau)
- **`/utils/string`** — String manipulation
- **`/utils/type`** — Type guards and type utilities
- **`/utils/vector`** — Vector math
- **`/utils/vfx`** — Visual effects helpers

### `@lisachandra/matter`

The heart of the ECS. Built on top of `@rbxts/matter`:

- **`/items`** — Item definitions, registry, serialization/deserialization, type descriptions
- **`/hooks`** — Matter hook wrappers (`useMemo`, `useChange`, `useReducer`, `useStream`, `useThrottle`, `useDocument`, `useMessage`)
- **`/packages`** — Package system for composable game features (plugin-like architecture)
- **`/network`** — Network registry, messaging abstractions, built-in network types (item, forces, node, sound, stream, hotbar, inventory, profile)
- **`/utils/item`** — Item utility functions
- **`/utils/entity`** — Entity lookup and management
- **`/utils/physics`** — Physics utilities
- **`/utils/sound`** — Sound helpers
- **Systems** — Client/server systems for items, sound, network replication, players, world nodes
- **Replication** — Server→client state replication through built-in network types
- **Pipeline** — Template family registration and processing pipeline

### `@lisachandra/ui`

React-based UI components and hooks:

- **`/hooks/useWorldToScreen`** — World-to-screen coordinate projection
- **`/hooks/usePx`** — Pixel-density-aware measurements
- **`/hooks/usePropertyBinding`** / **`/hooks/useProperty`** — Property change hooks
- **`/hooks/useConstant`** — Stable constant references
- **`/components/virtualScroller`** — Virtualized list rendering
- **Hot Reloader** — Component hot-reloading for development

### `@lisachandra/test`

Test utilities and runtime helpers for Jest Roblox (`@rbxts/jest`). Provides Luau runtime utilities used by test suites across the monorepo.

### `@lisachandra/react-template`

Instance → React component generator for Roblox. Turns a `ModuleScript` template (or instance) into a React component, with an `apiDump` utility for describing the template surface.

### `@lisachandra/react-router`

Client-side router for React Roblox: path matching, history tracking, `Router`/`RouteMatch` React context, and hooks (`useRouter`, `useRouteMatch`).

### `@lisachandra/platform`

Runtime platform glue:

- **`/bootstrap`** — Client and server startup orchestration
- **`/centurion`** — Admin commands (document, kick, set, teleport) with type-safe argument guards
- **`/document`** — Document-based data with Lapis persistence and validation
- **`/teleporter`** — Player teleportation between places/servers

### `@lisachandra/sandcastle`

Developer tooling (not a Roblox runtime package): a three-phase agent issue runner (design → implement → review) with persistent worktrees, sequential issue processing, and integration composition. Runs outside the game via a Node CLI (`sandcastle`) using `@ai-hero/sandcastle`.

---

## Technology Stack

| Technology                              | Purpose                                    |
| --------------------------------------- | ------------------------------------------ |
| **roblox-ts**                           | TypeScript-to-Luau compiler                |
| **pnpm** (v10)                          | Package manager with workspace support     |
| **Matter** (`@rbxts/matter`)            | Entity Component System                    |
| **Flamework** (`@flamework/core`)       | Dependency injection & lifecycle framework |
| **React** (`@rbxts/react`)              | UI rendering                               |
| **Centurion** (`@rbxts/centurion`)      | Admin command framework                    |
| **Lapis** (`@rbxts/lapis`)              | Data store abstraction                     |
| **Sift** (`@rbxts/sift`)                | Immutable data utilities                   |
| **Serio** (`@rbxts/serio`)              | Serialization/deserialization              |
| **Tether** (`@rbxts/tether`)            | Client-server messaging                    |
| **T** (`@rbxts/t`)                      | Runtime type validation                    |
| **Log** (`@rbxts/log`)                  | Structured logging                         |
| **LemonSignal** (`@rbxts/lemon-signal`) | Event signals                              |
| **Janitor** (`@rbxts/janitor`)          | Cleanup management                         |
| **Crate** (`@rbxts/crate`)              | Dependency injection                       |
| **Rewire** (`@rbxts/rewire`)            | Hot reloading                              |
| **Changesets**                          | Versioning and changelog generation        |
| **Jest Roblox**                         | Testing framework                          |
| **Rojo**                                | Roblox project syncing                     |

---

## Development Workflow

### Prerequisites

- **Node.js LTS** (managed via mise — see `mise.toml`)
- **pnpm** (enabled via corepack)
- **Rojo** `v7.7.0` (managed via mise)

### Common Commands

```bash
# Install dependencies
pnpm install

# Setup (install + build)
pnpm setup

# Build all packages and tests
pnpm build

# Build only packages (not tests)
pnpm build:packages

# Build only tests
pnpm build:test

# Build and watch (development)
pnpm dev

# Build only packages in watch mode
pnpm dev:packages

# Build only tests in watch mode
pnpm dev:test

# Lint / format / typecheck
pnpm lint
pnpm lint:fix
pnpm typecheck

# Serve with Rojo
pnpm serve

# Run tests
pnpm test

# Commit with commitlint conventions
pnpm commit

# Create a release (versioning + publish)
pnpm release
```

### Per-Package Commands

Each package supports:

```bash
cd packages/<name>
pnpm build    # Compile TypeScript → Luau (output to out/)
pnpm dev      # Watch mode
pnpm clean    # Remove out/
```

`@lisachandra/sandcastle` is the exception: it is plain Node/TypeScript.

```bash
cd packages/sandcastle
pnpm build    # tsc → dist/ (used by the sandcastle bin)
pnpm test     # node:test via tsx
```

### Adding a New Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `default.project.json`
2. Package name must follow `@lisachandra/<name>`
3. Add workspace dependency references (`"@lisachandra/types": "workspace:*"`)
4. Run `pnpm install` from root to link
5. Export maps in `package.json` should follow the `import`/`types` convention, pointing at compiled output under `out/` (e.g. `"./utils/x": { "import": "./out/utils/x.luau", "types": "./out/utils/x.d.ts" }`)

### Testing

- Tests use **Jest Roblox** (`@isentinel/jest-roblox`)
- Test helpers live in `test/`
- Shared Jest config: `jest.shared.ts`
- Per-package test configs in `test/<name>/jest.config.ts`

### Versioning & Publishing

- Uses **Changesets** for versioning
- `pnpm version` — bump versions based on changeset files
- `pnpm release` — publish all changed packages to npm (public access)

---

## Key Architectural Patterns

### Package System (matter)

The `packages/` subsystem in matter provides a plugin-like architecture where game features can be composed as "packages" with dependency resolution. Each package can register components, systems, hooks, and network types.

### Replication (matter)

Server→client state replication is handled through built-in network types (item, forces, node, sound, stream, hotbar, inventory, profile) registered via the network registry.

### Items (matter)

Items are the core gameplay entity: they have definitions, a registry, serialization (Serio-based), network synchronization, and both client/server management systems. The item system handles tools, hotbar assignments, and inventory management.

### Bootstrap (platform)

The bootstrap module provides standardized client/server initialization sequences — registering Flamework, starting Matter systems, and initializing platform services.

### Documents (platform)

Document-based data with JSON Schema validation for persisting player/entity data via Lapis data stores.

---

## Naming Conventions

- Package names: `@lisachandra/<name>`
- Workspace references: `workspace:*`
- Catalog versions: `catalog:` (managed centrally in `pnpm-workspace.yaml`)

---

## Owner

**lisachandra** <lisachandra@proton.me>
GitHub: https://github.com/lisachandra/rbxts
License: MIT
