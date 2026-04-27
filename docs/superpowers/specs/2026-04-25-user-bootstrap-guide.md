# User Bootstrap Guide — `@lisachandra/matter`

**Date:** 2026-04-25
**Scope:** Full user-facing bootstrap flow, external package integration, hot reloading

---

## Overview

This guide shows how a game project bootstraps the `@lisachandra/matter` runtime — from configuration to system composition to hot reloading. It covers:

1. **Runtime configuration** — entity lookup, player lifecycle, input adapters, documents
2. **Item definitions** — one-call `defineItems`
3. **System composition** — pipeline, template families, replication builder
4. **External npm packages** — how an NPC package provides systems and components
5. **Hot reloading** — how `packages/platform` and `packages/ui` wire into the bootstrap

---

## 1. External npm Packages: NPC Example

An external npm package (e.g., `@my-game/npcs`) can define Matter systems, components, and pipeline registrations, then have the user bootstrap them via the packages system.

### The NPC Package (`@my-game/npcs`)

```ts
// ============ @my-game/npcs/src/index.ts ============
import {
    definePackage,
    type MatterPackageDescriptor
} from "@lisachandra/matter";
import { component } from "@rbxts/matter";

// Define NPC components
export const NPC = component<{ health: number; owner?: Player }>("NPC");
export const NPCAI = component<{ behavior: string }>("NPCAI");

// Define NPC systems
function serverNPCManager(world: World): void {
    for (const [entityId, npc, ai] of world.query(NPC, NPCAI)) {
        // NPC AI logic...
    }
}

function clientNPCReplicator(world: World, crate: Crate<ClientState>): void {
    // Client-side NPC streaming...
}

// Export as a package that users register
export const npcPackage = definePackage({
    id: "npcs",
    dependencies: ["items"],  // NPCs depend on the items system
    metadata: {
        description: "NPC spawning, AI, and replication",
        version: "1.0.0",
    },
    pipeline: [
        {
            name: "npcRuntimeServer",
            systems: [
                { key: "serverNPCManager", system: serverNPCManager },
            ],
            dependencies: ["itemsRuntimeServer"],
        },
        {
            name: "npcRuntimeClient",
            systems: [
                { key: "clientNPCReplicator", system: clientNPCReplicator },
            ],
            dependencies: ["itemsRuntimeClient"],
        },
    ],
    replication: {
        components: [
            { component: "NPC", mode: "all" },
            { component: "NPCAI", mode: "owner" },
        ],
    },
});
```

### User Bootstraps the NPC Package

```ts
// ============ game/src/shared/bootstrap.ts ============
import { npcPackage } from "@my-game/npcs";
import {
    createPackageRegistry,
    createPackageRuntime,
    createPipeline,
    start,
    configureRuntimeAdapters,
} from "@lisachandra/matter";

// Register external packages
const registry = createPackageRegistry();
registry.register(npcPackage);

// Resolve dependency graph
const resolved = registry.resolve(["npcs"]);

// Compile into runnable systems
const runtime = createPackageRuntime(resolved);

// Build the final system array
const systems = runtime.buildSystems();

// Start the Matter loop
const { world, crate } = start({ systems });
```

This works because the packages system (`packages/`) handles:
- **Topological sort** (`resolvePackageGraph.ts`) — ensures `items` loads before `npcs`
- **Pipeline registration** — each package's `pipeline` entries become `SystemTemplate`s
- **Replication wiring** — each package's `replication` config feeds into the replication builder
- **State slices** — each package can declare its own crate state keys

---

## 2. Complete Bootstrap Flow

### Step 1: Runtime Configuration

```ts
// ============ game/src/shared/config.ts ============
import {
    configureRuntimeAdapters,
    configureEntityLookup,
    configureStreamableEntityLookup,
} from "@lisachandra/matter";
import { Components } from "@lisachandra/matter";

// -- Entity Lookup --
configureEntityLookup({
    instanceComponents: ["Profile", "Items", "Node"],
    humanoidComponents: ["Profile"],
});

// -- Streamable Entity Lookup --
configureStreamableEntityLookup({
    components: ["Items", "NPC", "Vehicle"],
});

// -- Player Lifecycle (fine-grained hooks) --
configureRuntimeAdapters({
    authorize: async (player) => player.UserId > 0,
    playerLifecycle: {
        preSpawn: async (player) => {
            // Validate before spawn — return false to reject
            return !myBanService.isBanned(player.UserId);
        },
        componentFactory: (player, janitor) => [
            Components.Profile({ janitor, player }),
            Components.Inventory(),
            Components.Hotbar(),
            Components.Forces(),
            // Game-specific:
            Components.Stats({ level: 1, xp: 0 }),
        ],
        postSpawn: (world, player, entityId) => {
            messaging.client.emit(player, Message.GameReady, { map: "lobby" });
        },
    },
    // Input adapter for toolManager (any input package — not just gamejoy)
    hotbarInputAdapter: {
        getHeldKeys: () => myInputSystem.getHeldKeys(),
        onKeyPressed: (cb) => myInputSystem.onKeyPressed(cb),
    },
    // Custom entity→instance resolution
    findInstanceFromEntity: (world, entityId) => {
        // Override default entity lookup if needed
        return undefined; // fall through to default
    },
    document: {
        collection,
        persistedComponents: {
            Hotbar: "hotbar",
            Inventory: "inventory",
            Stats: "stats",
        },
    },
});
```

### Step 2: Item Definitions

```ts
// ============ game/src/shared/items.ts ============
import { defineItems } from "@lisachandra/matter/items";
import createSerializer, { u16 } from "@rbxts/serio";

defineItems({
    Weapon: {
        description: "Weapons category",
        image: "rbxassetid://123",
        children: {
            Sword: {
                serdes: createSerializer<{ damage: u16; durability: u16 }>(),
                defaultData: { damage: 10, durability: 100 },
                description: "A sharp blade",
                image: "rbxassetid://456",
                privateKeys: ["durability"], // server-only
            },
            Bow: {
                serdes: createSerializer<{ damage: u16; range: u16 }>(),
                defaultData: { damage: 5, range: 50 },
            },
        },
    },
    Consumable: {
        children: {
            Potion: {
                serdes: createSerializer<{ healAmount: u16 }>(),
                defaultData: { healAmount: 25 },
                description: "Restores health",
            },
        },
    },
});
```

### Step 3: System Composition

There are three paths, depending on how much control you want:

#### Path A: Pre-built Template Families (Simplest)

```ts
// ============ game/src/server/bootstrap.ts ============
import {
    createMatterTemplateFamilies,
    createPipeline,
    start,
    type MatterTemplateResolvers,
} from "@lisachandra/matter";
import { bootstrap } from "@lisachandra/platform";

const resolvers: MatterTemplateResolvers = {
    server: {
        serverPlayerManager: playerManagerSystem,
        serverDocumentManager: documentManagerSystem,
        serverReplicationManager: replicationManagerSystem,
        serverItemManager: itemManagerSystem,
        // ... etc — any unresoloved keys get a placeholder that throws
    },
    client: {
        clientReplicationManager: replicationManagerSystem,
        clientItemManager: clientItemManagerSystem,
        // ...
    },
};

const families = createMatterTemplateFamilies(resolvers);
const pipeline = createPipeline()
    .use(...families.registrations);
    // Optionally exclude families: { exclude: ["sound"] }

const systems = pipeline.build();
const { world, crate, loop } = start({ systems });
```

#### Path B: Individual Feature Functions

```ts
import {
    useItemFeature,
    useNetworkFeature,
    useSoundFeature,
    useWorldFeature,
    usePlayerInitFeature,
    createPipeline,
} from "@lisachandra/matter";

const systems = createPipeline()
    .use(...usePlayerInitFeature({ server: { serverPlayerManager: myPM } }))
    .use(...useItemFeature({ server: { serverItemManager: myIM } }))
    .use(...useNetworkFeature({ /* ... */ }))
    .use(...useSoundFeature({ /* ... */ }))
    .override("serverItemManager", myCustomItemManager)  // swap one system
    .build();
```

#### Path C: External Packages (Most Modular)

```ts
import { npcPackage } from "@my-game/npcs";
import { questPackage } from "@my-game/quests";
import {
    createPackageRegistry,
    createPackageRuntime,
    start,
} from "@lisachandra/matter";

const registry = createPackageRegistry();
registry.registerMany([npcPackage, questPackage]);

const resolved = registry.resolve(["npcs", "quests"]);
const runtime = createPackageRuntime(resolved);
const systems = runtime.buildSystems();

const { world, crate } = start({ systems });
```

In Path C, `runtime.installReplication(builder)` also feeds replication templates into the replication builder, which you can then build and add to the pipeline.

---

## 3. How Phases Work

Each system declares its execution phase in its `meta` export:

```ts
export const meta = {
    phase: "preSimulation",   // or: heartbeat, preRender, stepped, etc.
    system: mySystem,
} satisfies SystemStruct<[World, Crate<...>, DebugWidgets]>;
```

`start()` binds these to Roblox events:

| Phase | Roblox Event |
|---|---|
| `"default"`, `"heartbeat"` | `RunService.Heartbeat` |
| `"preSimulation"` | `RunService.PreSimulation` |
| `"postSimulation"` | `RunService.PostSimulation` |
| `"preAnimation"` | `RunService.PreAnimation` |
| `"preRender"` | `RunService.PreRender` |
| `"stepped"` | `RunService.Stepped` |
| `"renderStepped"` | `RunService.RenderStepped` (client) |
| `"renderCamera"`, `"renderCharacter"`, `"renderFirst"`, `"renderInput"`, `"renderLast"` | `RunService.BindToRenderStep` with matching priority |
| `"Hz1"` – `"Hz60"` | `RunService.BindToSimulation` (fixed-step simulation) |
| `"playerModuleCamera"` | Custom `LemonSignal` |

Systems can also declare `after: [otherSystem]` to enforce execution order within a phase.

---

## 4. Hot Reloading Integration

Hot reloading is wired through **`packages/platform`** (bootstrap) and **`packages/ui`** (React UI).

### How It Works

```
packages/platform/bootstrap.ts
├── resolveBoundary()
│   ├── production: collectSystems([modules.client, modules.shared])
│   └── development: use hotReload.containers (empty systems initially)
│                     ^-- rewire HotReloader rescans these containers
│
└── bootstrap()
    └── start({ systems, containers })
        └── loop.scheduleSystems(systems)
```

In **development mode**: the bootstrap passes hot-reload container `Instance`s instead of pre-built system arrays. The `@rbxts/rewire` HotReloader watches these containers for module changes, re-requires changed modules, and re-registers their systems via the `Loop`.

### Platform Bootstrap (Client Example)

```ts
// The user calls bootstrap() from @lisachandra/platform:
import { bootstrap } from "@lisachandra/platform";

bootstrap({
    mode: "development",            // "development" → hot reload mode
    modules: {
        client: clientSystemsModule, // barrel module of client systems
        shared: sharedSystemsModule, // barrel module of shared systems
    },
    hotReload: {
        containers: [
            script.Parent!.WaitForChild("client") as Instance,
            script.Parent!.WaitForChild("shared") as Instance,
        ],
    },
    extensions: {
        // Additional systems from external packages
        systems: runtime.buildSystems(),
    },
});
```

In production mode (`mode: "production"`), `findSystems()` recursively scans the barrel modules and extracts all systems with `meta` exports. In development mode, the HotReloader rescans containers on every file change, and the `Loop` re-schedules updated systems on the next frame.

### UI Hot Reloading (`packages/ui`)

```ts
import { createAppHotReloader } from "@lisachandra/ui";
import React from "@rbxts/react";

const { hotReloader, load, render, start, unload } = createAppHotReloader({
    target: playerGui,              // Where to render (e.g., PlayerGui)
    moduleRoot: uiContainer,        // Instance containing UI module scripts
    entryModuleName: "app",         // First module to load
    resolveEntryModule: () => {     // Re-resolve entry after any file change
        return uiContainer.FindFirstChild("app") as ModuleScript;
    },
    strictMode: true,
});

// Start scanning for changes
start();
// On module change → rewire calls load(module) → require → render(app)
// Each render call unmounts the previous root and creates a new one.
```

---

## 5. Full Bootstrap Chain (Visual)

```
User code (game/src/shared/bootstrap.ts):
│
├── configureRuntimeAdapters({ playerLifecycle, inputAdapter, ... })
├── configureEntityLookup({ instanceComponents, humanoidComponents })
├── configureStreamableEntityLookup({ components })
├── configureRuntimeAdapters({ document: { collection, persistedComponents } })
├── defineItems({ Weapon: { Sword: {...}, Bow: {...} } })
│
├── [Path A] createMatterTemplateFamilies(resolvers)
│            → createPipeline().use(families).build()
│
├── [Path B] useItemFeature({...}) + useNetworkFeature({...})
│            → createPipeline().use(...).build()
│
├── [Path C] createPackageRegistry() + definePackage() + createPackageRuntime()
│            → runtime.buildSystems()
│            → runtime.installReplication(replBuilder)
│
└── start({ systems }) → [world, crate, loop]
    │
    ├── new World()
    ├── new Loop(world, store.shared)
    ├── loop.scheduleSystems(systems)
    └── loop.begin(phases)
        │
        ├── heartbeat   → systems with phase:"heartbeat"
        ├── preSimulation → systems with phase:"preSimulation"
        ├── preRender    → systems with phase:"preRender"
        └── ... etc
```

---

## 6. Creating a Document Collection

The user only needs to create the Lapis collection once:

```ts
// ============ game/src/shared/myDocumentCollection.ts ============
import { createCollection } from "@rbxts/lapis";
import { createDataStoreValidator } from "@lisachandra/platform";
import type { CollectionData } from "@lisachandra/core/store";

// Augment CollectionData to add game-specific keys
declare module "@lisachandra/core/store" {
    interface CollectionData {
        stats: { level: number; xp: number };
        gold: number;
    }
}

export const collection = createCollection<CollectionData>("PlayerData", {
    defaultData: {
        hotbar: [],
        inventory: [],
        stats: { level: 1, xp: 0 },
        gold: 0,
    },
    validate: createDataStoreValidator<CollectionData>(),
});
```

Then pass it to `configureRuntimeAdapters({ document: { collection } })` — done.

---

## 7. Key Design Principles

1. **Configuration over code** — users call config functions, don't fork internals
2. **Fine-grained hooks** — `preSpawn`, `componentFactory`, `postSpawn` instead of one monolithic `onPlayerAdded`
3. **Input abstraction** — `InputAdapter` decouples toolManager from any specific input library
4. **Document templating** — user provides only the Lapis `Collection`; the system handles the rest
5. **Package composability** — external npm packages can ship systems + components + replication config
6. **Hot reload from day one** — development mode is built into the bootstrap, not bolted on
