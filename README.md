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

`@lisachandra/rbxts` is a **pnpm monorepo** of reusable [roblox-ts](https://roblox-ts.com/) packages. Build once, template everywhere. Each package exposes a stable API surface so games can pull in only what they need.

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [`@lisachandra/types`](packages/types) | [![npm](https://img.shields.io/npm/v/@lisachandra/types)](https://www.npmjs.com/package/@lisachandra/types) | Global type augments for Roblox services |
| [`@lisachandra/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@lisachandra/core)](https://www.npmjs.com/package/@lisachandra/core) | Logger, store, schemas, 13 utility modules |
| [`@lisachandra/matter`](packages/matter) | [![npm](https://img.shields.io/npm/v/@lisachandra/matter)](https://www.npmjs.com/package/@lisachandra/matter) | ECS: components, hooks, items, networking, packages, pipeline |
| [`@lisachandra/ui`](packages/ui) | [![npm](https://img.shields.io/npm/v/@lisachandra/ui)](https://www.npmjs.com/package/@lisachandra/ui) | React UI components and hooks |
| [`@lisachandra/platform`](packages/platform) | [![npm](https://img.shields.io/npm/v/@lisachandra/platform)](https://www.npmjs.com/package/@lisachandra/platform) | Bootstrap, centurion commands, documents, teleporter |
| [`@lisachandra/test`](packages/test) | [![npm](https://img.shields.io/npm/v/@lisachandra/test)](https://www.npmjs.com/package/@lisachandra/test) | Test utilities for Jest Roblox |
| [`@lisachandra/react-template`](packages/react-template) | — | Instance → React component generator |
| [`@lisachandra/react-router`](packages/react-router) | — | Client-side router for React Roblox |

```
types  ←  core  ←  matter  ←  platform
              ↖__ ui _____/
               test _____/
```

## Full Bootstrap Guide

This guide covers the complete setup: runtime configuration, item definitions, system composition, external package integration, document persistence, admin commands, and hot reloading — all the way to a running game loop.

### 1. Installation

```bash
pnpm add @lisachandra/types @lisachandra/core @lisachandra/matter @lisachandra/platform
pnpm add @rbxts/matter @rbxts/centurion @rbxts/lapis @rbxts/flamework @rbxts/serio
pnpm add @rbxts/crate @rbxts/janitor @rbxts/lemon-signal @rbxts/tether @rbxts/sift
pnpm add @rbxts/services @rbxts/log @rbxts/luau-polyfill @rbxts/object-utils
```

All packages are published with **public access**. Peer dependencies must be installed in the consuming project.

### 2. Runtime Configuration

```ts
// src/shared/config.ts
import {
  configureRuntimeAdapters,
  configureEntityLookup,
  configureStreamableEntityLookup,
  getComponent,
} from "@lisachandra/matter";
import { configureLogger } from "@lisachandra/core/logger";
import { LogLevel } from "@rbxts/log";
import { collection } from "./documents/playerData";

configureLogger({
  defaultVersion: "0.1.0",
  isProduction: false,
  logLevel: LogLevel.Debugging,
});

// Which components identify an entity for instance/humanoid lookups
configureEntityLookup({
  instanceComponents: ["Profile", "Items", "Node"],
  humanoidComponents: ["Profile"],
});

// Which components make an entity eligible for workspace streaming
configureStreamableEntityLookup({
  components: ["Items"],
});

// Full runtime adapters
configureRuntimeAdapters({
  // Optional: custom authorization (default allows UserId > 0)
  authorize: async (player) => player.UserId > 0,

  // Player lifecycle hooks
  playerLifecycle: {
    // Validate before spawning — return [false, "reason"] to kick
    preSpawn: async (player) => [!myBanService.isBanned(player.UserId)],

    // Customize which components are inserted into the player entity.
    // Called AFTER the entity is spawned and document is loaded.
    // Must include Profile with the scoped Janitor.
    componentFactory: (player, janitor) => [
      getComponent("Profile")({ janitor, player }),
      getComponent("Inventory")(),
      getComponent("Hotbar")(),
      getComponent("Forces")(),
    ],

    // Called AFTER spawn, component insertion, and Message.Time emit.
    // Message.Time is already sent by the default flow — do NOT re-emit it here.
    postSpawn: (world, player, entityId) => {
      print(`Player ${player.Name} spawned as entity ${entityId}`);
    },

    // Completely replaces the default playerAdded logic if provided.
    // Your implementation owns: spawn entity, load documents, insert components, emit Message.Time, etc.
    // onPlayerAdded: (world, player) => { /* full custom lifecycle */ },

    // Called BEFORE default cleanup (janitor destroy + entity despawn)
    onPlayerRemoving: (world, player) => {
      print(`Player ${player.Name} leaving`);
    },
  },

  // Optional: decouples toolManager from a specific input library
  hotbarInputAdapter: {
    getHeldKeys: () => myInputSystem.getHeldKeys(),
    onKeyPressed: (cb) => myInputSystem.onKeyPressed(cb),
  },

  // Optional: custom instance-from-entity lookup
  // findInstanceFromEntity: (world, entityId) => { /* custom lookup */ },

  // Document persistence config
  document: {
    collection,
    persistedComponents: {
      Hotbar: "hotbar",
      Inventory: "inventory",
    },
  },
});
```

### 3. Item Definitions

```ts
// src/shared/items.ts
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
        privateKeys: ["durability"], // never replicated to clients
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

This single call populates the item definitions tree, serdes registry, description registry, and numeric ID registry. `Components.Item` becomes type-safe — `item.data.damage` is now `number`.

### 4. System Composition

There are three paths to compose systems. Choose one.

**Zero boilerplate:** import `builtinPackage` from `@lisachandra/matter/systems` and drop it into `packages` in `bootstrap()` — all builtin systems are wired automatically.

#### Path A — Direct Systems (simpler)

Use when you have a flat list of systems or rely on `@lisachandra/platform` to auto-collect from barrel modules:

```ts
import { start } from "@lisachandra/matter";

const { world, crate, loop } = start({
  systems: [
    healthRegenSystem,
    playerManagerSystem,
    itemManagerSystem,
  ],
});
```

#### Path B — External Packages via Package Runtime

Use when you want dependency ordering, package composition, and package-provided replication codecs. External npm packages can ship systems, components, and replication codecs together:

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

// Register package codecs into the shared replication registry
runtime.installCodecs(registry);

// Build the final ordered system array
const systems = runtime.buildSystems();
const { world, crate } = start({ systems });
```

> You can also use `createPackageRuntime().installPipeline(builder)` to compose package registrations into a custom pipeline before building.

#### Path C — Builtin Packages via `bootstrap()`

Use `@lisachandra/matter/systems` `builtinPackage` to include all builtin matter systems (player lifecycle, items, replication, sound, world nodes) with a single import:

```ts
import { bootstrap } from "@lisachandra/platform";
import { builtinPackage } from "@lisachandra/matter/systems";
import { npcPackage } from "@my-game/npcs";

bootstrap({
  mode: "development",
  packages: [builtinPackage, npcPackage],
  modules: {
    server: myServerSystems,
    shared: mySharedSystems,
  },
});
```

`bootstrap()` internally creates a registry, registers all package descriptors, resolves them by ID, builds the ordered system array, and merges them with systems from `modules` and `extensions`. No manual registry/runtime management required.

### 5. Creating Custom Components

To add your own components, augment the `Components` interface and register a runtime factory. This is the pattern external npm packages (like `@my-game/npcs`) use to ship components with systems and replication codecs.

```ts
// src/shared/components.ts
import { registerComponent, type Components } from "@lisachandra/matter";
import { component } from "@rbxts/matter";

// Step 1: Augment the Components interface to teach TypeScript about your component.
// External packages do this in their own index.ts, game code does it in shared/config.
declare module "@lisachandra/matter/out/components" {
  interface Components {
    NPC: {
      health: number;
      maxHealth: number;
      owner?: Player;
    };
    Stats: {
      level: number;
      xp: number;
    };
  }
}

// Step 2: Register runtime component constructors so the ECS can create them by key.
// Do this ONCE at import time (top-level), before start() is called.
registerComponent(
  "NPC",
  component<Components["NPC"]>("NPC"),
);

registerComponent(
  "Stats",
  component<Components["Stats"]>("Stats", { level: 1, xp: 0 }),
);

// Now getComponent("NPC") is fully typed and world.query(getComponent("NPC")) works.
// In systems, access fields type-safely: npc.health, npc.maxHealth, npc.owner
```

> **Key insight:** `declare module "@lisachandra/matter/out/components"` extends the type map. `registerComponent()` creates the runtime factory. Both are needed. The module augmentation path points at the compiled output so it works across packages.

> If you forget the runtime registration, `getComponent("NPC")` will return `undefined` at runtime even though TypeScript allows the key. Always pair them together.

### 6. Writing Systems

Each system declares its execution phase in a `meta` export:

```ts
// src/server/systems/healthRegen.ts
import type { World, SystemStruct } from "@rbxts/matter";
import type { Crate } from "@rbxts/crate";
import type { ServerState } from "@lisachandra/core/store";
import { useChange } from "@lisachandra/matter";

function healthRegen(world: World, _crate: Crate<ServerState>) {
    for (const [entityId, npc] of world.query(getComponent("NPC"))) {
      if (useChange([npc.health], entityId)) {
        world.insert(entityId, npc.patch({
          health: math.min(npc.health + 1, npc.maxHealth),
        }));
      }
    }
  },

export const meta = {
  phase: "Hz1",
  system: healthRegen
} satisfies SystemStruct<[World, Crate<ServerState>]>;
```

| Phase | Roblox Event |
|---|---|
| `"default"`, `"heartbeat"` | `RunService.Heartbeat` |
| `"preSimulation"` | `RunService.PreSimulation` |
| `"postSimulation"` | `RunService.PostSimulation` |
| `"preAnimation"` | `RunService.PreAnimation` |
| `"preRender"` | `RunService.PreRender` |
| `"stepped"` | `RunService.Stepped` |
| `"renderStepped"` | `RunService.RenderStepped` (client only) |
| `"renderCamera"`, `"renderCharacter"`, `"renderFirst"`, `"renderInput"`, `"renderLast"` | `RunService.BindToRenderStep` with matching priority (client only) |
| `"Hz1"` – `"Hz60"` | `RunService.BindToSimulation` |
| `"playerModuleCamera"` | Custom `LemonSignal` (client only) |

Systems can declare `after: [otherSystem]` to enforce execution order within a phase.

### 7. Bootstrap the Server

```ts
// src/server/main.server.ts
import { bootstrap } from "@lisachandra/platform";
import { builtinPackage } from "@lisachandra/matter/systems";
import { setupLogger } from "@lisachandra/core/logger";

// Side-effect imports: configuration and auto-registration
import "../shared/config";
import "../shared/items";
import "@lisachandra/platform/centurion/commands";

import * as serverSystems from "./systems";
import * as sharedSystems from "../shared/systems";

setupLogger();

const { world, crate, loop, boundary } = bootstrap({
  mode: "development",       // "production" disables Rewire hot reload
  modules: {
    server: serverSystems,   // Flamework barrel — systems with meta export are auto-collected
    shared: sharedSystems,
  },
  packages: [builtinPackage], // Include all builtin matter systems
  extensions: {
    systems: [/* any extra systems */],
  },
});

print("Server started!");
```

### 8. Bootstrap the Client

```ts
// src/client/main.client.ts
import { bootstrap } from "@lisachandra/platform";
import { builtinPackage } from "@lisachandra/matter/systems";
import { setupLogger } from "@lisachandra/core/logger";

import "../shared/config";
import "../shared/items";

import * as clientSystems from "./systems";
import * as sharedSystems from "../shared/systems";

setupLogger();

const { world, crate } = bootstrap({
  modules: {
    client: clientSystems,
    shared: sharedSystems,
  },
  packages: [builtinPackage], // Include all builtin matter systems
});
```

### 9. Hot Reloading

In **development mode**, the bootstrap passes hot-reload container `Instance`s into the Matter loop via `hotReload.containers`. The `@rbxts/rewire` hot reloader watches those containers for module changes and re-registers systems automatically.

```ts
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

For **React UI** hot reloading, use `@lisachandra/ui`:

```ts
import { createAppHotReloader } from "@lisachandra/ui";

const { start } = createAppHotReloader({
  target: playerGui,
  moduleRoot: uiContainer,
  entryModuleName: "app",
  resolveEntryModule: () => uiContainer.FindFirstChild("app") as ModuleScript,
  strictMode: true,
});

start();
```

### 10. Document Collection

Create a Lapis collection for persistent player data:

```ts
// src/server/documents/playerData.ts
import { createCollection } from "@rbxts/lapis";
import { createDataStoreValidator } from "@lisachandra/platform/document";
import type { CollectionData } from "@lisachandra/core/store";

// Optionally augment CollectionData for custom fields
declare module "@lisachandra/core/store" {
  interface CollectionData {
    gold: number;
    stats: { level: number; xp: number };
  }
}

export const collection = createCollection<CollectionData>("PlayerData", {
  defaultData: {
    hotbar: [],
    inventory: [],
    gold: 0,
    stats: { level: 1, xp: 0 },
  },
  validate: createDataStoreValidator<CollectionData>(),
});
```

Pass it via `configureRuntimeAdapters({ document: { collection } })`.

### 11. Admin Commands (Centurion)

```ts
// src/server/commands.ts
import { configureCenturionGroup, configureCenturionRoles } from "@lisachandra/platform/centurion/guards";

configureCenturionGroup(1234567);           // Roblox group ID
configureCenturionRoles(["Developer", "Founder"]);

// Importing the commands module auto-registers them with Centurion:
import "@lisachandra/platform/centurion/commands";
```

Built-in commands: `teleport` (aliases: `tp`), `kick`, `document`, `set`.

### 12. Using Items at Runtime

```ts
import { createItem, spawnItem, addItem, moveItem, removeItem, getItemFromGUID } from "@lisachandra/matter/utils/item";

// Create and spawn a sword in the world
const sword = createItem(["Weapon", "Sword"], { damage: 15 });
const entityId = spawnItem(sword, someCFrame);

// Add to a player's inventory
addItem(playerEntityId, "Inventory", sword);

// Move between hotbar and inventory
moveItem(playerEntityId, sword.guid, "Hotbar");

// Look up items
const item = getItemFromGUID(sword.guid);

// Remove
removeItem(sword.guid, 1);
```

### 13. The Store

```ts
import { store } from "@lisachandra/core/store";

// Client
store.client.getState("debugEnabled");
store.client.getState("playerEntityId");

// Server
store.server.getState("documents");
store.server.getState("itemGUIDMap");

// Shared on both sides
store.shared.getState("itemPointers");

// The Matter world instance
store.world;

// State change signal
store.diffSignal;
```

### Full Bootstrap Chain (Visual)

```text
User code:
│
├── configureLogger({ ... })
├── configureEntityLookup({ instanceComponents, humanoidComponents })
├── configureStreamableEntityLookup({ components })
├── configureRuntimeAdapters({ playerLifecycle, inputAdapter, document, ... })
├── defineItems({ Weapon: { Sword: {...}, Bow: {...} } })
│
├── [Direct]  systems = [systemA, systemB, ...]
│
├── [Packages] createPackageRegistry() + definePackage() + createPackageRuntime()
│              → runtime.installCodecs(registry)
│              → runtime.buildSystems()
│
└── bootstrap({ systems, modules, hotReload })
    └── start({ systems, containers })
        ├── new World()
        ├── new Loop(world, store.shared, containers)
        ├── loop.scheduleSystems(systems)
        └── loop.begin(phases: {
              default, heartbeat, preSimulation, postSimulation,
              preAnimation, preRender, stepped, renderStepped,
              renderCamera, renderCharacter, renderFirst,
              renderInput, renderLast, Hz1–Hz60, playerModuleCamera
            })
```

## Detailed API Documentation

Per-package reference with examples:

| Package | Docs |
|---|---|
| `@lisachandra/types` | [docs/types.md](docs/types.md) |
| `@lisachandra/core` | [docs/core.md](docs/core.md) |
| `@lisachandra/matter` | [docs/matter.md](docs/matter.md) |
| `@lisachandra/ui` | [docs/ui.md](docs/ui.md) |
| `@lisachandra/platform` | [docs/platform.md](docs/platform.md) |
| `@lisachandra/test` | [docs/test.md](docs/test.md) |
| React packages | [docs/react.md](docs/react.md) |

## Development

```bash
pnpm install         # install all workspace deps
pnpm build           # build all packages + tests
pnpm dev             # build and watch
pnpm test            # run test suites
pnpm release         # version and publish changed packages
```

## License

[MIT](LICENSE.md)

---

**Owner:** [lisachandra](https://github.com/lisachandra) <lisachandra@proton.me>
