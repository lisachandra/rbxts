# @lisachandra/matter

The ECS runtime — built on `@rbxts/matter` with components, hooks, networking, items, a package system, and game systems for both client and server.

## Install

```bash
pnpm add @lisachandra/matter
```

Peer dependencies: `@lisachandra/types`, `@lisachandra/core`, `@rbxts/matter`, `@rbxts/crate`, `@rbxts/janitor`, `@rbxts/lemon-signal`, `@rbxts/tether`, `@rbxts/serio`, `@rbxts/sift`, `@rbxts/services`, `@rbxts/log`, `@rbxts/luau-polyfill`, `@rbxts/object-utils`, `@rbxts/object-cache`, `@flamework/core`, `@rbxts/t`, `@rbxts/lapis`, `@rbxts/plasma`, `@rbxts/rewire`, `type-fest`

## Submodule Exports

| Import | Purpose |
|---|---|
| `@lisachandra/matter` | Everything: components, hooks, network, items, packages, pipeline, entity lookup, phases, startup |
| `@lisachandra/matter/packages` | Composable game feature packages |
| `@lisachandra/matter/items` | Item definitions, registry, serialization |
| `@lisachandra/matter/utils/item` | Item utility functions |
| `@lisachandra/matter/utils/entity` | Entity lookup and management |
| `@lisachandra/matter/utils/physics` | Physics utilities |
| `@lisachandra/matter/utils/sound` | Sound management |

---

## Quick Start

```ts
import { start, configureRuntimeAdapters } from "@lisachandra/matter";
import { setupLogger } from "@lisachandra/core/logger";
import { store } from "@lisachandra/core/store";

// Configure adapters before starting
configureRuntimeAdapters({
  document: { collection: myLapisCollection },
  playerLifecycle: {
    postSpawn(world, player, entityId) {
      print(`Player ${player.Name} spawned as entity ${entityId}`);
    },
  },
});

// Start the Matter loop
const { world, crate, loop } = start({
  systems: mySystems,
});

// The store is now available
store.world; // Same as `world`
```

---

## Components

Pre-built components with runtime registration:

| Component | Data Shape |
|---|---|
| `Profile` | `{ janitor, player }` |
| `Items` | `{ items: Item[], model: Model, moved?: boolean }` |
| `Inventory` | `{ items: Item[] }` |
| `Hotbar` | `{ equipped: string, items: Item[], order: string[] }` |
| `Stream` | `{ container: Instance, value: "in" \| "out" }` |
| `Forces` | `{ alignOrientation, linearVelocity, forces: Array<{force, time}> }` |
| `Sound` | `{ id: number, effects?, emitter?, players? }` |
| `Node` | `{ model: BasePart, occupiedBy?, type: number }` |
| `ReplicationScope` | `Array<{ components, ids, mode }>` |

```ts
import { getComponent, registerComponent, type Components } from "@lisachandra/matter";
import { component } from "@rbxts/matter";

// Use built-in components
const hotbar = world.get(entityId, getComponent("Hotbar"));

// ── Creating Custom Components ──────────────────────────────────
// Step 1: Augment the Components interface for type-safety.
// External packages do this in their index.ts; game code in shared/config.
declare module "@lisachandra/matter/components" {
  interface Components {
    NPC: { health: number; maxHealth: number; owner?: Player };
    Stats: { level: number; xp: number };
  }
}

// Step 2: Register runtime constructors ONCE at import time.
// Without this, getComponent("NPC") returns undefined at runtime.
registerComponent("NPC", component<Components["NPC"]>("NPC"));
registerComponent("Stats", component<Components["Stats"]>("Stats", { level: 1, xp: 0 }));

// Now world.query(getComponent("NPC")) is fully typed.
// In systems: npc.health, npc.maxHealth, npc.owner — all type-safe.
```

---

## Hooks

Matter wrappers that provide React-like patterns in ECS systems:

```ts
import { useMemo, useChange, useReducer, useThrottle, useStream, useMessage } from "@lisachandra/matter";

// Memoize values with dependency tracking
const value = useMemo(() => expensiveCalc(), [dep1, dep2]);

// Detect dependency changes
if (useChange([someValue])) {
  // Only runs when someValue changed
}

// State reducer pattern
const [state, dispatch] = useReducer(reducer, initialState);

// Throttle execution
if (useThrottle(5)) {  // true every 5 seconds
  // Periodic work
}

// Stream workspace instances by attribute
for (const [_, event] of useStream(entityId)) {
  if (event.adding) { /* instance entered */ }
}

// Listen for network messages
for (const [_, player, data] of useMessage(messaging.server, Message.MoveItemTo)) {
  // Handle the packet
}
```

---

## Networking

### Messaging

Predefined message types via `@rbxts/tether`:

```ts
import { Message, messaging } from "@lisachandra/matter";

// Server → Client
messaging.client.emit(player, Message.Time, { startClock, startEpoch });
messaging.client.emitAll(Message.ItemGUIDMap, guidMap);

// Client → Server
messaging.server.emit(Message.Loaded, undefined);
messaging.server.emit(Message.MoveItemTo, { destination: true, guid });
```

| Message | Direction | Payload |
|---|---|---|
| `Loaded` | C→S | `undefined` |
| `Time` | S→C | `{ startClock, startEpoch }` |
| `SpawnEntity` | S→C | `u32` |
| `DespawnEntity` | S→C | `u32` |
| `ItemGUIDMap` | S→C | `Record<string, u16>` |
| `ResyncItem` | S↔C | `string` |
| `MoveItemTo` | C→S | `{ destination, guid }` |
| `DropItem` | C→S | `{ amount, guid }` |

### Built-in Replication Codecs

Every component has a registered replication codec for server→client sync:

| Component | Mode |
|---|---|
| `Profile` | `all` |
| `Items` | `all` |
| `Inventory` | `owner` |
| `Hotbar` | `owner` |
| `Forces` | `all` |
| `Sound` | `owner` |
| `Node` | `all` |
| `Stream` | `all` |

Custom codecs:
```ts
import { registry } from "@lisachandra/matter";

registry.register({
  component: getComponent("NPC"),
  mode: "all",
  serializer: (record, playerEntityId, componentEntityId) => record.new,
  deserializer: (data, serverEntityId, clientEntityId) => data,
  serdes: createSerializer<NPCPayload>(),
});
```

---

## Items

Define game items with hierarchies, serialization, and default data:

```ts
import { defineItems, createItem, spawnItem, getItemFromGUID } from "@lisachandra/matter";
import createSerializer, { u16 } from "@rbxts/serio";

defineItems({
  Weapon: {
    description: "Weapons category",
    image: "rbxassetid://123",
    children: {
      Sword: {
        serdes: createSerializer<{ damage: u16 }>(),
        defaultData: { damage: 10 },
        description: "A sharp blade",
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
      },
    },
  },
});

// Create and spawn an item
const sword = createItem(["Weapon", "Sword"], { damage: 15 });
const entityId = spawnItem(sword, someCFrame);

// Look up items
const item = getItemFromGUID("some-guid");
```

### Item Utilities (`@lisachandra/matter/utils/item`)

```ts
import { addItem, moveItem, removeItem, createItem, spawnItem, getCompleteItem } from "@lisachandra/matter/utils/item";

addItem(entityId, "Inventory", item);
moveItem(entityId, guid, "Hotbar");
removeItem(guid, 1);
```

---

## Entity Lookup & Utilities

```ts
import { getEntityObject, getEntityPosition, getEntityHumanoid, ownsEntity } from "@lisachandra/matter/utils/entity";

const model = getEntityObject(entityId);
const pos = getEntityPosition(entityId);
const humanoid = getEntityHumanoid(entityId);
const isMine = ownsEntity(entityId);
```

---

## Packages

A plugin-like architecture for composable game features:

```ts
import { createPackageRegistry, createPackageRuntime, definePackage } from "@lisachandra/matter/packages";

const registry = createPackageRegistry<string, AnySystem>();

const pkg = definePackage({
  id: "combat",
  dependencies: ["items"],
  pipeline: [combatSystemTemplate],
  replication: {
    codecs: [combatCodec],
  },
});

registry.register(pkg);
const resolved = registry.resolve(["combat"]);
const runtime = createPackageRuntime(resolved);
const systems = runtime.buildSystems();
```

---

## Pipeline

Build ordered system arrays with dependencies:

```ts
import { createPipeline } from "@lisachandra/matter";

const systems = createPipeline<AnySystem>()
  .use(mySystemTemplate)
  .use(myExtension)
  .override("someSystemKey", replacementSystem)
  .build();

// Feed into start()
start({ systems });
```

---

## Physics (`@lisachandra/matter/utils/physics`)

```ts
import { applyImpulse, clearForces, ragdoll, unRagdoll, setSpeed, setVelocity, pivotTo } from "@lisachandra/matter/utils/physics";

applyImpulse(entityId, { direction, magnitude, maxTorque, decayTime });
setSpeed(entityId, 30, tweenInfo);
ragdoll(character);
```

---

## Sound (`@lisachandra/matter/utils/sound`)

```ts
import { placeCharacterAudioInWorld, soundEmitterCache, findFreeAudioNode } from "@lisachandra/matter/utils/sound";

const node = placeCharacterAudioInWorld(world, entityId, soundAsset, nodeMarker);
```

---

## Runtime Configuration

```ts
import { configureRuntimeAdapters, configureEntityLookup, configureStreamableEntityLookup } from "@lisachandra/matter";

// Entity lookup: which components identify an entity
configureEntityLookup({
  instanceComponents: ["Profile", "Items", "Node"],
  humanoidComponents: ["Profile"],
});

// Streamable entities
configureStreamableEntityLookup({
  components: ["Items"],
});

// Full runtime adapters
configureRuntimeAdapters({
  authorize: async (player) => player.UserId > 0,
  findInstanceFromEntity: (world, entityId) => { /* custom lookup */ },
  playerLifecycle: {
    preSpawn: (player) => [true],
    componentFactory: (player, janitor) => [/* custom components */],
    postSpawn: (world, player, entityId) => {},
    onPlayerAdded: (world, player) => { /* full custom lifecycle */ },
    onPlayerRemoving: (world, player) => {},
  },
  hotbarInputAdapter: {
    getHeldKeys: () => [Enum.KeyCode.One],
    onKeyPressed: (cb) => { /* return disconnect fn */ },
  },
  document: {
    collection: myCollection,
    persistedComponents: { Hotbar: "hotbar", Inventory: "inventory" },
  },
});
```

---

## Systems (Built-in)

### Client Systems
- `item/itemManager` — Item state synchronization with server
- `item/toolManager` — Hotbar tool equipping via input
- `item/hotbarSynchronizer` — Hotbar order consistency
- `sound/soundRenderer` — Audio rendering and playback
- `sound/soundManager` — Client-side sound lifecycle
- `network/replicationManager` — Deserialize incoming server packets
- `network/clientStreamer` — Streamable entity in/out tracking

### Server Systems
- `item/itemManager` — Item interactions (move, drop, pickup)
- `item/toolManager` — Tool creation and cleanup
- `item/hotbarManager` — Hotbar equip/unequip management
- `player/playerManager` — Player join/leave lifecycle
- `player/documentManager` — Persist components to Lapis documents
- `sound/soundManager` — Server-side audio setup
- `network/replicationManager` — Serialize and send component changes

### Shared Systems
- `sound/soundManager` — Garbage collect finished sound entities
- `world/nodeManager` — Clean up nodes when components are removed
