# @lisachandra/matter

The ECS runtime: `@rbxts/matter` plus everything a game needs around it — components, system hooks,
networking, items, and the built-in systems for players, replication, sound, and world nodes.

Most games never call `start()` directly. `bootstrap()` from `@lisachandra/platform` composes the
systems and starts the loop for you; this package is where the pieces it wires together live.

## Components

Every component constructor lives on one `Components` object — built-in and custom alike. Use it
directly; there is no lookup function.

```ts
import { Components } from "@lisachandra/matter";

const hotbar = world.get(entityId, Components.Hotbar);
for (const [entityId, inventory] of world.query(Components.Inventory)) {
	// ...
}
```

The built-ins are `Profile` (a player entity's janitor and player), `Items` (items in the world),
`Inventory` and `Hotbar` (a player's containers), `Stream` (workspace streaming state), `Forces`
(constraints applied to an entity), `Sound`, `Node` (a world marker), and `ReplicationScope`.

### Adding a component

Two halves are required, and forgetting the second is the usual bug: augmenting the interface teaches
TypeScript about the data, while assigning a constructor gives the ECS something to create.

```ts
import { Components } from "@lisachandra/matter";
import { component } from "@rbxts/matter";

declare module "@lisachandra/matter/components" {
	interface Components {
		NPC: { health: number; maxHealth: number; owner?: Player };
	}
}

Components.NPC = component<Components["NPC"]>("NPC"); // once, at import time, before any query
```

If the assignment is missing, reading `Components.NPC` logs a warning and yields `undefined` rather than
throwing — so a component that "just doesn't work" is usually this.

## Hooks

React-style state, keyed by entity, for the bookkeeping systems always end up doing.

```ts
import { useChange, useMemo, useThrottle } from "@lisachandra/matter";

if (useChange([npc.health], entityId)) {
	// only when health actually changed
}

const stats = useMemo(() => computeStats(npc), [npc.level], entityId);

if (useThrottle(5, entityId)) {
	// at most once every 5 seconds — ideal for costly scans
}
```

`useStream` tracks workspace instances whose `serverEntityId` attribute matches the id it is given
(override with `{ attribute }`), and `useMessage` drains the network queue for a message. `useDocument`
loads a Dataforge profile on the server.

`useMessage` yields differently by side: `[index, data]` on the client, `[index, player, data]` on the
server, because only the server knows who sent it.

## Networking

`messaging` is a Tether emitter whose message set is fixed, so both sides agree on payloads:

```ts
import { Message, messaging } from "@lisachandra/matter";

messaging.client.emit(player, Message.Time, { startClock, startEpoch }); // S→C
messaging.server.emit(Message.Loaded, undefined); // C→S
```

The set covers the handshake (`Loaded`, `Time`), entity lifecycle (`SpawnEntity`, `DespawnEntity`), item
sync (`ItemGUIDMap`, `ResyncItem`, `MoveItemTo`, `DropItem`), and `Component` for replicated component
payloads.

### Replication

Built-in components replicate without configuration: `Profile`, `Items`, `Forces`, `Node`, and `Stream`
to everyone, `Inventory`, `Hotbar`, and `Sound` only to the owning player.

A custom component needs a codec registered, or it stays server-side:

```ts
import { Components, registry } from "@lisachandra/matter";

registry.register<Components["NPC"], Components["NPC"]>({
	component: Components.NPC,
	deserializer: (data) => data,
	mode: "owner", // or "all"
	serializer: (record) => record.new,
});
```

## Items

`defineItems` is the whole item setup in one call: it fills the definition tree, the serializers, the
descriptions, and the numeric IDs, and makes each item's `data` type-safe from its serdes.

```ts
import { defineItems } from "@lisachandra/matter/items";
import createSerializer, { u16 } from "@rbxts/serio";

defineItems({
	Weapon: {
		description: "Weapons",
		children: {
			Sword: {
				serdes: createSerializer<{ damage: u16; durability: u16 }>(),
				defaultData: { damage: 10, durability: 100 },
				privateKeys: ["durability"], // stays on the server
			},
		},
	},
});
```

From then on `createItem(["Weapon", "Sword"], { damage: 15 }).data.damage` is a `number`, and
`privateKeys` are stripped from what clients receive.

### Moving items around

Pass the `World` explicitly. The older helpers in `utils/item` read `store.world` behind your back and
are deprecated — they still work, but new code should not use them.

```ts
import { createItem } from "@lisachandra/matter/utils/item/lookup";
import {
	addItem,
	getItemFromGUID,
	moveItem,
	removeItem,
	spawnItem,
} from "@lisachandra/matter/utils/item/state";

const sword = createItem(["Weapon", "Sword"], { damage: 15 });
const entityId = spawnItem(world, sword, cframe);
addItem(world, playerEntityId, "Inventory", sword);
moveItem(world, playerEntityId, sword.guid, "Hotbar");
removeItem(world, sword.guid, 1);
const found = getItemFromGUID(world, sword.guid);
```

## Composing systems

Three approaches, in increasing order of structure:

```ts
// 1. A flat list
start({ systems: [mySystem, myOtherSystem] });

// 2. Packages with dependencies and codecs
const packages = createPackageRegistry<"npcs" | "quests">();
packages.register(npcPackage);
packages.register(questPackage);

const runtime = createPackageRuntime(packages.resolve(["npcs", "quests"]));
runtime.installCodecs(registry);
start({ systems: runtime.buildSystems() });

// 3. Everything built in, via bootstrap()
bootstrap({ packages: [builtinPackage] });
```

`builtinPackage` from `@lisachandra/matter/systems` is a single descriptor that includes every built-in
system in dependency order: player lifecycle, items, replication, sound, and world nodes. It is the
normal choice unless you are deliberately replacing one of those systems.

`createPipeline()` is the builder underneath — `use`, `override(key, system)`, `build()` — for changing
one system in an otherwise standard set.

## Configuration

Anything that varies by game is configured before `start()`.

```ts
import {
	configureEntityLookup,
	configureRuntimeAdapters,
	configureStreamableEntityLookup,
} from "@lisachandra/matter";

// Which components identify an entity, so instance and humanoid lookups can find it
configureEntityLookup({
	instanceComponents: ["Profile", "Items", "Node"],
	humanoidComponents: ["Profile"],
});

// Which entities participate in workspace streaming
configureStreamableEntityLookup({ components: ["Items"] });

configureRuntimeAdapters({
	playerLifecycle: {
		preSpawn: async (player) => [true], // [false, "reason"] kicks
		componentFactory: (player, janitor) => [
			Components.Profile({ janitor, player }),
			Components.Inventory(),
			Components.Hotbar(),
			Components.Forces(),
		],
	},
	document: {
		store, // a Dataforge store
	},
});
```

`persistedComponents` is declared on the document config but is not read by anything yet, so it has no
effect — the `store.documents` middleware is what actually writes to Dataforge.

Two hooks are worth knowing before you need them: `onPlayerAdded` **replaces** the entire default
lifecycle (spawn, document load, component insertion, `Message.Time`), so using it means owning all of
that; `postSpawn` runs after the default flow and is the usual place for extra setup.
