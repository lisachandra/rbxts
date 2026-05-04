# @lisachandra/platform

Platform glue: bootstrap orchestration, Centurion admin commands, document persistence, and player teleportation.

## Install

```bash
pnpm add @lisachandra/platform
```

Peer dependencies: `@lisachandra/types`, `@lisachandra/matter`, `@lisachandra/core`, `@flamework/core`, `@rbxts/centurion`, `@rbxts/lapis`, `@rbxts/services`, `@rbxts/log`, `@rbxts/sift`, `@rbxts/t`, `@rbxts/serio`, `@rbxts/object-utils`, `@rbxts/rbxts-hashlib`, `@rbxts/regexp`, `@rbxts/luau-polyfill`, `@rbxts/matter`, `type-fest`

## Submodule Exports

| Import | Purpose |
|---|---|
| `@lisachandra/platform` | Main: bootstrap, centurion utilities, teleporter |
| `@lisachandra/platform/bootstrap` | Client/server startup |
| `@lisachandra/platform/centurion/type` | Centurion type definitions |
| `@lisachandra/platform/centurion/guards` | Command authorization guards |
| `@lisachandra/platform/centurion/commands` | Admin commands |
| `@lisachandra/platform/centurion/types` | Custom Centurion argument types |
| `@lisachandra/platform/centurion/utility` | Type builder helpers |
| `@lisachandra/platform/teleporter` | Player teleportation |
| `@lisachandra/platform/document` | Document-based data |

---

## Bootstrap

The single entry point for starting the game on client or server:

```ts
import { bootstrap } from "@lisachandra/platform";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import { collection } from "./documents/playerData";

// Server entry point (main.server.ts)
configureRuntimeAdapters({
  document: { collection },
  playerLifecycle: {
    preSpawn: async (player) => [true],
    postSpawn(world, player, entityId) {
      print(`Player ${player.Name} spawned!`);
    },
  },
});

const { world, crate, loop, boundary } = bootstrap({
  mode: "development",
  systems: mySystems,
  modules: {
    server: serverSystems,  // Flamework barrel module
    shared: sharedSystems,
  },
  hotReload: {
    containers: [rewireContainer],
  },
});

// Client entry point (main.client.ts)
const { world, crate } = bootstrap({
  modules: { client: clientSystems, shared: sharedSystems },
});
```

### `BootstrapOptions`

| Option | Type | Description |
|---|---|---|
| `mode?` | `"development" \| "production"` | Enables Rewire hot reload when development |
| `modules?` | `{ client?, server?, shared? }` | Flamework barrel modules for auto-system discovery |
| `systems?` | `Array<AnySystem>` | Pre-resolved systems from pipeline/registry |
| `hotReload?` | `{ containers? }` | Hot reload containers (development only) |
| `extensions?` | `{ containers?, modules?, systems? }` | Ad-hoc extensions merged into boundary |

### `BootstrapResult`

```ts
interface BootstrapResult {
  world: World;
  crate: Crate<ClientState | ServerState>;
  loop: Loop<any>;
  boundary: BootstrapBoundary;
}
```

---

## Centurion Commands

Pre-built admin commands with authorization:

| Command | Description | Arguments |
|---|---|---|
| `teleport` (aliases: `tp`) | Teleport players to a target | `from: Players`, `target: Player` |
| `kick` | Kick players from the server | `players: Players` |
| `document` | Get document info for a player | `user: Number` |
| `set` | Set properties on an item by GUID | `itemGuid: String`, `properties: String` |

```ts
// Commands use @rbxts/centurion decorators
// Importing the commands module auto-registers them
import "@lisachandra/platform/centurion/commands";
```

### Custom Argument Types

```ts
import { Entity, Entities } from "@lisachandra/platform/centurion/types";

// Single entity by name/@me/@id
// Multi-entity with @all, @others, @query(), @except(), @only() prefixes
```

### Guards

```ts
import { configureCenturionGroup, configureCenturionRoles, adminOrDeveloper } from "@lisachandra/platform/centurion/guards";

configureCenturionGroup(1234567);  // Roblox group ID
configureCenturionRoles(["Developer", "Founder"]);

// adminOrDeveloper is used as @Guard on all commands
```

### Utility

```ts
import { makeListableType, makeEnumType } from "@lisachandra/platform/centurion/utility";

// Make a single type listable
const ListablePlayer = makeListableType("Players", CenturionType.Player);

// Create an enum type
const GameModeType = makeEnumType("GameMode", ["Survival", "Creative", "Adventure"]);
```

---

## Teleporter

Secure, retryable player teleportation between places:

```ts
import { teleport, serializeTeleportData, configureTeleport, configureTeleportSecret, isValidTeleport } from "@lisachandra/platform/teleporter";

// Configure once at startup
configureTeleport({ expiration: 300, attempts: 3, retry_delay: 1 });
configureTeleportSecret("my-secret-string");

// Serialize data for teleport
const options = serializeTeleportData({ /* custom data */ });

// Teleport players
const [success, result] = await teleport(placeId, [player], options);

// Validate on arrival
const { success, validHash, unexpired } = isValidTeleport(player);
```

---

## Document

Lapis-based data persistence with validation:

```ts
import { collection } from "@lisachandra/platform/document";
// Or use the create helper:
import { createCollection } from "@rbxts/lapis";

// Create a custom collection
const collection = createCollection("PlayerData", {
  defaultData: {
    banned: { value: false },
    hotbar: [],
    inventory: [],
  },
  validate: createDataStoreValidator<CollectionData>(),
});

// Pass to matter
configureRuntimeAdapters({ document: { collection } });
```
