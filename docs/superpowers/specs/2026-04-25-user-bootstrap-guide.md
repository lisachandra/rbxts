# User Bootstrap Guide — `@lisachandra/matter`

**Date:** 2026-04-25
**Scope:** Full user-facing bootstrap flow, external package integration, hot reloading

---

## Overview

This guide shows how a game project bootstraps the `@lisachandra/matter` runtime — from configuration to system composition to hot reloading. It covers:

1. **Runtime configuration** — entity lookup, player lifecycle, input adapters, documents
2. **Item definitions** — one-call `defineItems`
3. **System composition** — direct systems, package runtime, pipeline registrations
4. **External npm packages** — how a package provides systems, components, and replication codecs
5. **Hot reloading** — how `packages/platform` and `packages/ui` wire into the bootstrap

---

## 1. External npm Packages: NPC Example

An external npm package (for example `@my-game/npcs`) can define Matter systems, components, and replication codecs, then let the user bootstrap them through the packages system.

### The NPC Package (`@my-game/npcs`)

```ts
// ============ @my-game/npcs/src/index.ts ============
import {
    definePackage,
    registerComponent,
    type ComponentTypeMap,
} from "@lisachandra/matter";
import { registry, type ReplicationCodecRegistration } from "@lisachandra/matter";
import { component, type World } from "@rbxts/matter";
import type { Crate } from "@rbxts/crate";
import type { ClientState } from "@lisachandra/core/out/store";
import createSerializer, { u16 } from "@rbxts/serio";

declare module "@lisachandra/matter" {
    interface Components {
        NPC: { health: number; owner?: Player };
        NPCAI: { behavior: string };
    }
}

// Define NPC components
export const NPC = registerComponent(
    "NPC",
    component<Components["NPC"]>("NPC"),
);

export const NPCAI = registerComponent(
    "NPCAI",
    component<Components["NPCAI"]>("NPCAI"),
);

// Define NPC systems
function serverNPCManager(world: World): void {
    for (const [entityId, npc, ai] of world.query(NPC, NPCAI)) {
        // NPC AI logic...
    }
}

function clientNPCReplicator(world: World, crate: Crate<ClientState>): void {
    // Client-side NPC logic...
}

const npcCodecs: ReadonlyArray<ReplicationCodecRegistration> = [
    {
        component: NPC,
        mode: "all",
        serializer: (record) => ({ health: record.new!.health }),
        deserializer: (data) => ({ health: (data as { health: number }).health }),
        serdes: createSerializer<{ health: u16 }>(),
    {
        component: NPCAI,
        mode: "owner",
        serializer: (record) => ({ behavior: record.new!.behavior }),
        deserializer: (data) => ({ behavior: (data as { behavior: string }).behavior }),
    },
];

// Export as a package that users register
export const npcPackage = definePackage({
    id: "npcs",
    dependencies: ["items"],
    metadata: {
        description: "NPC spawning, AI, and replication",
        version: "1.0.0",
    },
    pipeline: [
        {
            name: "npcRuntimeServer",
            systems: [{ key: "serverNPCManager", system: serverNPCManager }],
        },
        {
            name: "npcRuntimeClient",
            systems: [{ key: "clientNPCReplicator", system: clientNPCReplicator }],
        },
    ],
    replication: {
        codecs: npcCodecs,
    },
});
```

### User Bootstraps the NPC Package

```ts
// ============ game/src/shared/bootstrap.ts ============
import { createPackageRegistry, createPackageRuntime, registry, start } from "@lisachandra/matter";
import { npcPackage } from "@my-game/npcs";

const packageRegistry = createPackageRegistry();
packageRegistry.register(npcPackage);

const resolved = packageRegistry.resolve(["npcs"]);
const runtime = createPackageRuntime(resolved);

// Register package codecs into the shared replication registry
runtime.installCodecs(registry);

// Build the final system array
const systems = runtime.buildSystems();

// Start the Matter loop
const { world, crate } = start({ systems });
```

This works because the packages system (`packages/`) handles:
- **Topological sort** (`resolvePackageGraph.ts`) — ensures dependencies load in order
- **Pipeline registration** — each package's `pipeline` entries become runnable systems
- **Replication wiring** — each package's `replication.codecs` is registered into the replication codec registry
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
    getComponent,
} from "@lisachandra/matter";
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
            return [!myBanService.isBanned(player.UserId)];
        },
        componentFactory: (player, janitor) => [
            getComponent("Profile")({ janitor, player }),
            getComponent("Inventory")(),
            getComponent("Hotbar")(),
            getComponent("Forces")(),
            getComponent("Stats")({ level: 1, xp: 0 }),
        ],
        postSpawn: (world, player, entityId) => {
            // Message.Time is already emitted by the default flow before this hook runs.
            // Use this for game-specific post-spawn setup only.
        },
    },
    hotbarInputAdapter: {
        getHeldKeys: () => myInputSystem.getHeldKeys(),
        onKeyPressed: (cb) => myInputSystem.onKeyPressed(cb),
    },
    findInstanceFromEntity: (world, entityId) => {
        return undefined;
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
                privateKeys: ["durability"],
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

There are two primary paths, depending on how much composition you want.

#### Path A: Direct Systems

Use this when you already have a flat system list or are relying on `@lisachandra/platform` to collect systems from barrel modules.

```ts
import { start } from "@lisachandra/matter";

const systems = [
    playerManagerSystem,
    documentManagerSystem,
    replicationManagerSystem,
    itemManagerSystem,
];

const { world, crate, loop } = start({ systems });
```

#### Path B: External Packages + Pipeline Runtime

Use this when you want dependency ordering, package composition, and package-provided codecs.

```ts
import {
    createPackageRegistry,
    createPackageRuntime,
    registry,
    start,
} from "@lisachandra/matter";
import { npcPackage } from "@my-game/npcs";
import { questPackage } from "@my-game/quests";

const packageRegistry = createPackageRegistry();
packageRegistry.registerMany([npcPackage, questPackage]);

const resolved = packageRegistry.resolve(["npcs", "quests"]);
const runtime = createPackageRuntime(resolved);

runtime.installCodecs(registry);

const systems = runtime.buildSystems();
const { world, crate } = start({ systems });
```

If you want more control, `createPackageRuntime().installPipeline(builder)` still lets you compose package registrations into a custom pipeline before building.

---

## 3. How Phases Work

Each system declares its execution phase in its `meta` export:

```ts
export const meta = {
    phase: "preSimulation",
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
| `"Hz1"` – `"Hz60"` | `RunService.BindToSimulation` |
| `"playerModuleCamera"` | Custom `LemonSignal` |

Systems can also declare `after: [otherSystem]` to enforce execution order within a phase.

---

## 4. Hot Reloading Integration

Hot reloading is wired through **`packages/platform`** (bootstrap) and **`packages/ui`** (React UI).

### How It Works

```text
packages/platform/bootstrap.ts
├── resolveBoundary()
│   ├── production: collect systems from provided modules/systems
│   └── development: use hotReload.containers for rewire rescans
│
└── bootstrap()
    └── start({ systems, containers })
        └── loop.scheduleSystems(systems)
```

In **development mode**, the bootstrap passes hot-reload container `Instance`s into the Matter loop. The `@rbxts/rewire` hot reloader watches those containers for module changes and re-registers systems.

### Platform Bootstrap (Client Example)

```ts
import { bootstrap } from "@lisachandra/platform";

bootstrap({
    mode: "development",
    modules: {
        client: clientSystemsModule,
        shared: sharedSystemsModule,
    },
    hotReload: {
        containers: [
            script.Parent!.WaitForChild("client") as Instance,
            script.Parent!.WaitForChild("shared") as Instance,
        ],
    },
    extensions: {
        systems: runtime.buildSystems(),
    },
});
```

In production mode, `findSystems()` recursively scans the barrel modules and extracts systems with `meta` exports. In development mode, the hot reloader rescans containers on file changes and the `Loop` re-schedules them.

### UI Hot Reloading (`packages/ui`)

```ts
import { createAppHotReloader } from "@lisachandra/ui";
import React from "@rbxts/react";

const { hotReloader, load, render, start, unload } = createAppHotReloader({
    target: playerGui,
    moduleRoot: uiContainer,
    entryModuleName: "app",
    resolveEntryModule: () => uiContainer.FindFirstChild("app") as ModuleScript,
    strictMode: true,
});

start();
```

---

## 5. Full Bootstrap Chain (Visual)

```text
User code:
│
├── configureRuntimeAdapters({ playerLifecycle, inputAdapter, ... })
├── configureEntityLookup({ instanceComponents, humanoidComponents })
├── configureStreamableEntityLookup({ components })
├── defineItems({ Weapon: { Sword: {...}, Bow: {...} } })
│
├── [Direct] systems = [systemA, systemB, ...]
│
├── [Packages] createPackageRegistry() + definePackage() + createPackageRuntime()
│            → runtime.installCodecs(registry)
│            → runtime.buildSystems()
│
└── start({ systems }) → [world, crate, loop]
    ├── new World()
    ├── new Loop(world, store.shared)
    ├── loop.scheduleSystems(systems)
    └── loop.begin(phases)
```

---

## 6. Creating a Document Collection

The user only needs to create the Lapis collection once:

```ts
// ============ game/src/shared/myDocumentCollection.ts ============
import { createCollection } from "@rbxts/lapis";
import { createDataStoreValidator } from "@lisachandra/platform";
import type { CollectionData } from "@lisachandra/core/store";

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

Then pass it to `configureRuntimeAdapters({ document: { collection } })`.

---

## 7. Key Design Principles

1. **Configuration over code** — users call config functions, don't fork internals
2. **Fine-grained hooks** — `preSpawn`, `componentFactory`, `postSpawn` instead of one monolithic `onPlayerAdded`
3. **Input abstraction** — `InputAdapter` decouples toolManager from any specific input library
4. **Type-safe extensibility** — external packages augment `ComponentTypeMap` and register runtime component constructors
5. **Package composability** — external npm packages can ship systems + components + replication codecs
6. **Hot reload from day one** — development mode is built into the bootstrap, not bolted on
