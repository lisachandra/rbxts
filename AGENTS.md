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
│   └── preset/         @lisachandra/preset     — Composition presets and feature toggles
├── test/               Test helpers and shared Jest config
├── docs/               Additional documentation
├── pnpm-workspace.yaml
├── tsconfig.json       Base tsconfig extending @isentinel/tsconfig/roblox
└── package.json        Root scripts (build, dev, release)
```

### Dependency Graph (simplified)

```
types  ←  core  ←  matter  ←  platform  ←  preset
              ↖__ ui _____/
```

- **types** has no internal dependencies (leaf package)
- **core** depends on types
- **matter** depends on core + types
- **ui** depends on core + types
- **platform** depends on matter + core + types
- **preset** composes everything (matter, platform, ui, core)

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
- **`/utils/validate`** — Runtime validation
- **`/utils/vector`** — Vector math
- **`/utils/vfx`** — Visual effects helpers

### `@lisachandra/matter`
The heart of the ECS. Built on top of `@rbxts/matter`:
- **`/items`** — Item definitions, registry, serialization/deserialization, type descriptions
- **`/hooks`** — Matter hook wrappers (`useMemo`, `useChange`, `useReducer`, `usePacket`, `useStream`, `useThrottle`)
- **`/packages`** — Package system for composable game features (plugin-like architecture)
- **`/network`** — Network registry, messaging abstractions, built-in network types (item, forces, node, sound, stream, hotbar, inventory, profile)
- **`/utils/item`** — Item utility functions (615 lines — core item logic)
- **`/utils/sound`** — Sound helpers
- **`/utils/physics`** — Physics utilities
- **`/utils/entity`** — Entity lookup and management
- **Systems** — Client/server systems for items, sound, network replication, players, world nodes
- **Replication** — Replication builder and presets for server→client sync
- **Pipeline** — Template family registration and processing pipeline
- **Templates** — Template instantiation and management

### `@lisachandra/ui`
React-based UI components and hooks:
- **`/hooks/useWorldToScreen`** — World-to-screen coordinate projection
- **`/hooks/usePx`** — Pixel-density-aware measurements
- **`/hooks/usePropertyBinding`** / **`/hooks/useProperty`** — Property change hooks
- **`/hooks/useConstant`** — Stable constant references
- **`/components/virtualScroller`** — Virtualized list rendering
- **Hot Reloader** — Component hot-reloading for development

### `@lisachandra/platform`
Runtime platform glue:
- **`/bootstrap`** — Client and server startup orchestration
- **`/centurion`** — Admin commands (give, ban, kick, teleport, announce, document, set, unban) with type-safe argument guards
- **`/documents`** — Document-based data with validation
- **`/teleporter`** — Player teleportation between places/servers

### `@lisachandra/preset`
High-level compositions that wire multiple packages together with feature toggles. The entry point for a game to consume the full stack.

---

## Technology Stack

| Technology | Purpose |
|---|---|
| **roblox-ts** | TypeScript-to-Luau compiler |
| **pnpm** (v10) | Package manager with workspace support |
| **Matter** (`@rbxts/matter`) | Entity Component System |
| **Flamework** (`@flamework/core`) | Dependency injection & lifecycle framework |
| **React** (`@rbxts/react`) | UI rendering |
| **Centurion** (`@rbxts/centurion`) | Admin command framework |
| **Lapis** (`@rbxts/lapis`) | Data store abstraction |
| **Sift** (`@rbxts/sift`) | Immutable data utilities |
| **Serio** (`@rbxts/serio`) | Serialization/deserialization |
| **Tether** (`@rbxts/tether`) | Client-server messaging |
| **T** (`@rbxts/t`) | Runtime type validation |
| **Log** (`@rbxts/log`) | Structured logging |
| **LemonSignal** (`@rbxts/lemon-signal`) | Event signals |
| **Janitor** (`@rbxts/janitor`) | Cleanup management |
| **Crate** (`@rbxts/crate`) | Dependency injection |
| **Rewire** (`@rbxts/rewire`) | Hot reloading |
| **Changesets** | Versioning and changelog generation |
| **Jest Roblox** | Testing framework |
| **Rojo** | Roblox project syncing |

---

## Development Workflow

### Prerequisites
- **Node.js LTS** (managed via mise — see `mise.toml`)
- **pnpm** (enabled via corepack)
- **Rojo** `v7.7.0-rc.1` (managed via mise)

### Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build and watch (development)
pnpm dev

# Build only packages (not test)
pnpm build:packages

# Serve with Rojo
pnpm serve

# Create a release (versioning + publish)
pnpm release
```

### Per-Package Commands
Each package supports:
```bash
cd packages/matter
pnpm build    # Compile TypeScript → Luau (output to out/)
pnpm dev      # Watch mode
pnpm clean    # Remove out/
```

### Adding a New Package
1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `default.project.json`
2. Package name must follow `@lisachandra/<name>`
3. Add workspace dependency references (`"@lisachandra/types": "workspace:*"`)
4. Run `pnpm install` from root to link
5. Export maps in `package.json` should follow the `source`/`import`/`types` convention

### Testing
- Tests use **Jest Roblox** (`@isentinel/jest-roblox`)
- Test helpers live in `test/`
- Shared Jest config: `jest.shared.ts`
- Run with: `pnpm --filter "./test/**" build`

### Versioning & Publishing
- Uses **Changesets** for versioning
- `pnpm version` — bump versions based on changeset files
- `pnpm release` — publish all changed packages to npm (public access)

---

## Key Architectural Patterns

### Package System (matter)
The `packages/` subsystem in matter provides a plugin-like architecture where game features can be composed as "packages" with dependency resolution. Each package can register components, systems, hooks, and network types.

### Replication (matter)
Server→client state replication is handled through a builder pattern (`createReplicationBuilder`) with built-in presets for common payloads (items, inventory, hotbar, sound, profile).

### Items (matter)
Items are the core gameplay entity: they have definitions, a registry, serialization (Serio-based), network synchronization, and both client/server management systems. The item system handles tools, hotbar assignments, and inventory management.

### Bootstrap (platform)
The bootstrap module provides standardized client/server initialization sequences — registering Flamework, starting Matter systems, and initializing platform services.

### Documents (platform)
Document-based data with JSON Schema validation for persisting player/entity data.

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
