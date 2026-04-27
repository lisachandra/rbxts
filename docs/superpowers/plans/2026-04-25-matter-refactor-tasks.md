# Matter Package Refactoring — Implementation Tasks

**Date:** 2026-04-25
**Scope:** `packages/matter` + `packages/platform/src/document/`
**Status:** In Progress

---

## Task Overview

| # | Task | Status |
|---|---|---|
| 1 | `defineItems` helper function | ✅ Done |
| 2 | Network builtins serdes migration to `network/builtins/` | ✅ Done |
| 3 | Streamable Entity Lookup Group (`entityLookup.ts`) | ✅ Done |
| 4 | ToolManager Input Abstraction (`InputAdapter`) | ✅ Done |
| 5 | Player Lifecycle Hooks Overhaul | ⚠️ In Progress |
| 6 | Document System Overhaul (platform + matter) | ⚠️ In Progress |
| 7 | Audio Migration | ✅ Skipped (user solved) |
| 8 | System Initialization API Verification | ✅ Verified — clean |
| 9 | Build Verification | 🔲 Pending |

---

## Task 5: Player Lifecycle Hooks Overhaul

**Goal:** Replace the binary `onPlayerAdded` (all-or-nothing) with fine-grained hooks so users can customize individual steps without reimplementing the entire default flow.

### Plan

**Files to modify:**
- `packages/matter/src/start.ts` — New `PlayerLifecycleHooks` interface
- `packages/matter/src/systems/server/player/playerManager.ts` — Refactor `defaultPlayerAdded`

### New Interface

```ts
export interface PlayerLifecycleHooks {
    /** Validate before spawn. Return false → player kicked. */
    preSpawn?: (player: Player) => boolean | Promise<boolean>;

    /** Customize which components are inserted.
     *  Default: [Profile(…), Inventory(), Hotbar(), Forces()] */
    componentFactory?: (player: Player, janitor: Janitor) => Array<Component<object>>;

    /** Called AFTER spawn + component insertion + Time emit. */
    postSpawn?: (world: World, player: Player, entityId: AnyEntity) => void;

    /** (BACKWARD COMPAT) Fully replace default flow. */
    onPlayerAdded?: (world: World, player: Player) => void;

    /** Called BEFORE default cleanup. */
    onPlayerRemoving?: (world: World, player: Player) => void;
}
```

### Implementation Steps

- [ ] **Step 1:** Update `PlayerLifecycleHooks` in `start.ts`
- [ ] **Step 2:** Refactor `defaultPlayerAdded()` in `playerManager.ts` to call hooks at each step:
  1. Call `preSpawn` — if returns false, kick player
  2. Spawn entity + wait for Loaded message + load document
  3. Call `componentFactory` (or use default set)
  4. Insert components + emit Time
  5. Call `postSpawn`
- [ ] **Step 3:** Keep `onPlayerAdded` as full replacement (backward compat)
- [ ] **Step 4:** Build: `pnpm --filter @lisachandra/matter build`

---

## Task 6: Document System Overhaul

**Goal:** Remove game-specific code from `platform/src/document/create.ts`, let user configure only the Lapis collection, and fix bugs in `useDocument` calls.

### Problems Found

| File | Issue |
|---|---|
| `platform/src/document/create.ts` | Imports game-specific paths (`"server/document/types"`, `"shared/matter/components"`, `"shared/utils/validate"`) |
| `platform/src/document/index.ts` | Re-exports `"./use"` — **file doesn't exist** (runtime error) |
| `matter/src/systems/server/player/playerManager.ts` | `useDocument(player.UserId, player)` — **missing `Collection` param** |
| `matter/src/systems/server/player/documentManager.ts` | Same `useDocument` bug |
| `matter/src/systems/server/player/documentManager.ts` | Hardcodes `["Hotbar", "Inventory"]` as persisted components |
| `platform/src/document/types.d.ts` | Missing — referenced but doesn't exist |

### Plan

#### Part A: New `DocumentConfig` in `matter/src/start.ts`

- [ ] **Step 1:** Add `DocumentConfig` interface
- [ ] **Step 2:** Add `configureDocuments()` function
- [ ] **Step 3:** Add `getDocumentConfig()` accessor

```ts
export interface DocumentConfig {
    /** The Lapis collection. This is the ONLY thing the user provides. */
    collection: Collection<any, any>;
    /** Map component name → document key for persistence.
     *  Default: { Hotbar: "hotbar", Inventory: "inventory" } */
    persistedComponents?: Record<string, string>;
}
```

#### Part B: Fix `useDocument` calls

- [ ] **Step 4:** Fix `playerManager.ts` — pass `DocumentConfig.collection` to `useDocument`
- [ ] **Step 5:** Fix `documentManager.ts` — pass `DocumentConfig.collection` to `useDocument`

#### Part C: Fix `documentManager.ts`

- [ ] **Step 6:** Use `persistedComponents` from config instead of hardcoded `["Hotbar", "Inventory"]`
- [ ] **Step 7:** Map component name → document key via config

#### Part D: Clean up `platform/src/document/`

- [ ] **Step 8:** **DELETE** `platform/src/document/create.ts` (game-specific, not portable)
- [ ] **Step 9:** Fix `platform/src/document/index.ts` — remove broken `"./use"` export, keep `validate` + types
- [ ] **Step 10:** Create `platform/src/document/types.d.ts` with user-facing types

#### Part E: No change to `core/src/store.ts`

The user augments `CollectionData` via TypeScript declaration merging:
```ts
declare module "@lisachandra/core/store" {
    interface CollectionData {
        stats: { level: number; xp: number };
    }
}
```

---

## Task 8: System Initialization API Verification

**Verdict:** ✅ The API is clean. No changes needed.

### What was checked

- `start.ts` exports: `start()`, `findSystems()`, `configureRuntimeAdapters()`, `configureEntityLookup()`, `configureStreamableEntityLookup()`, `isAuthorized()`, `findInstanceFromEntity()`, `getHotbarInputAdapter()`, `getPlayerLifecycleHooks()`
- `platform/bootstrap/runtime.ts` wraps these: `bootstrapClientRuntime()`, `bootstrapServerRuntime()`, `resolveClientBootstrapRuntimeBoundary()`, `resolveServerBootstrapRuntimeBoundary()`
- `platform/bootstrap/server.ts` / `client.ts` provide `bootstrapServer()` / `bootstrapClient()`
- `platform/bootstrap/index.ts` re-exports all bootstrap functions

### Bootstrap chain (verified)

```
bootstrapClient/Server(options)
  → resolve...Boundary(options)
    → resolve...RuntimeBoundary(options)
      → build...Boundary(options)
        → mergeBoundary(boundary, mode, extensions)
          → start(systems, containers)
```

### Phases binding (verified)

`phases.ts` binds phase names to Roblox events:
- `heartbeat` → `RunService.Heartbeat`
- `preSimulation` → `RunService.PreSimulation`
- `renderStepped` → `RunService.RenderStepped` (client only)
- Render priority phases → `RunService.BindToRenderStep`
- Simulation Hz phases → `RunService.BindToSimulation`
- `playerModuleCamera` → custom `LemonSignal`

---

## Task 9: Build Verification

- [ ] **Step 1:** Run `pnpm build` (excluding `packages/preset`)
- [ ] **Step 2:** Fix any compilation errors
- [ ] **Step 3:** Verify `packages/platform` builds (depends on `@lisachandra/matter`)
- [ ] **Step 4:** Verify `packages/ui` builds (depends on `@lisachandra/core`)

---

## Files Not Touched (Verified Clean)

| Module | Purpose | Action |
|---|---|---|
| `pipeline/` | Builder pattern for ordered system lists with topological sort | ✅ No changes |
| `templates.ts` | Template families (networking, player, documents, items, sound, tooling) | ✅ No changes |
| `replication/` | Replication builder + `createDefaultReplicationPreset()` | ✅ No changes |
| `packages/` | Plugin architecture with dependency resolution | ✅ No changes |
| `phases.ts` | Custom Matter loop phases bound to Roblox events | ✅ No changes |
| `hookConnector.ts` | Request queue for deferred callback execution | ✅ No changes |
| `network/builtins/` | All component codecs registered with `registry` | ✅ No changes |
| `network/registry.ts` | `ReplicationCodecRegistry` with `register`/`get`/`entries` | ✅ No changes |
| `hooks/` | `useChange`, `useMemo`, `useMessage`, `useReducer`, `useStream`, `useThrottle`, `useDocument` | ✅ No changes (except `useDocument` bug fix for missing Collection param) |

---

## Known Bugs (Pre-existing, Not Regression)

| Bug | File | Severity |
|---|---|---|
| `useDocument` called without `Collection` param | `playerManager.ts:79`, `documentManager.ts:68` | 🔴 Runtime crash |
| `"./use"` re-export doesn't exist | `platform/src/document/index.ts` | 🔴 Runtime error |
| `"./types"` re-export missing | `platform/src/document/index.ts` | 🔴 Type error |
| Game-specific imports | `platform/src/document/create.ts` | 🟡 Not portable |
| `Configurations.Server.resync_interval` reference | `client/item/itemManager.ts:63` | 🔴 References missing config |
| `Configurations.Items.pickup_range` reference | `server/item/itemManager.ts:87` | 🔴 References missing config |
