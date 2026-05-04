# @lisachandra/core

Core runtime primitives: structured logging, reactive store, character schemas, and 13 utility modules.

## Install

```bash
pnpm add @lisachandra/core
```

Peer dependencies: `@lisachandra/types`, `@flamework/core`, `@rbxts/crate`, `@rbxts/lapis`, `@rbxts/lemon-signal`, `@rbxts/log`, `@rbxts/luau-polyfill`, `@rbxts/matter`, `@rbxts/message-templates`, `@rbxts/services`, `@rbxts/sift`, `@rbxts/validate-tree`, `@rbxts/t`, `@rbxts/object-cache`, `type-fest`

## Submodule Exports

| Import | Purpose |
|---|---|
| `@lisachandra/core/logger` | Structured logging |
| `@lisachandra/core/store` | Reactive state crate |
| `@lisachandra/core/schemas` | Character validation schemas |
| `@lisachandra/core/utils/asset` | Asset ID resolution |
| `@lisachandra/core/utils/cframe` | CFrame utilities |
| `@lisachandra/core/utils/color` | Color manipulation |
| `@lisachandra/core/utils/formatTable` | Table formatting (Luau) |
| `@lisachandra/core/utils/main` | General-purpose utilities |
| `@lisachandra/core/utils/math` | Math helpers |
| `@lisachandra/core/utils/r6ik` | R6 inverse kinematics (Luau) |
| `@lisachandra/core/utils/string` | String manipulation |
| `@lisachandra/core/utils/type` | Type guards and utilities |
| `@lisachandra/core/utils/vector` | Vector math |
| `@lisachandra/core/utils/vfx` | Visual effects helpers |

---

## Logger (`@lisachandra/core/logger`)

Structured logging via `@rbxts/log`. Supports configurable log levels, production mode, and version enrichment.

```ts
import { configureLogger, setupLogger, logOutput } from "@lisachandra/core/logger";

// Configure before calling setupLogger
configureLogger({
  defaultVersion: "1.2.3",
  isProduction: false,
  logLevel: LogLevel.Debugging,
});

// Initialize the logger (call once at startup)
setupLogger();

// Read in-memory log buffer (last 128 entries as [time, message] pairs)
for (const [time, msg] of logOutput) {
  print(time, msg);
}
```

### API

| Export | Description |
|---|---|
| `LoggerConfig` | Configuration shape for the logger |
| `loggerConfig` | Mutable config object (defaults: version `"0.1.0"`, non-production, Debugging) |
| `logLevel` | Current active log level |
| `configureLogger(config)` | Applies partial config updates |
| `fullLogOutputs` | Full historical log batches (when buffer overflows) |
| `logOutput` | Current in-memory log buffer (max 128 entries) |
| `setupLogger()` | Installs the logger sink |

---

## Store (`@lisachandra/core/store`)

A reactive state primitive built on `@rbxts/crate` with client/server state separation.

```ts
import { store } from "@lisachandra/core/store";

// Client-side state
store.client.getState().debugEnabled;       // boolean
store.client.getState("entityIdMap");       // Record<number, number>
store.client.getState("playerEntityId");    // AnyEntity | undefined

// Server-side state
store.server.getState("documents");         // Record<string, CollectionData>
store.server.getState("itemGUIDMap");       // Record<string, number>

// Shared access (works on both sides)
store.shared.getState("itemPointers");      // Record<string, string>

// The Matter World instance
store.world;  // World

// Diff signal (fires on state changes)
store.diffSignal;  // Signal<CrateDiff<...>>

// Server-only: hotbar storage
store.hotbar;  // Instance (Folder)

// Server-only: loaded player documents
store.documents;  // Partial<Record<string, Document<CollectionData>>>
```

### State Shapes

**`ClientState`:**
```ts
interface ClientState {
  debugEnabled: boolean;
  entityIdMap: Record<ServerEntityId, ClientEntityId>;
  itemGUIDMap: Record<string, number>;
  itemPointers: Record<string, string>;
  playerEntityId?: AnyEntity;
  serverStartClock: number;
  serverStartEpoch: number;
}
```

**`ServerState`:**
```ts
interface ServerState {
  serverStartClock: number;
  serverStartEpoch: number;
  itemGUIDMap: Record<string, number>;
  itemPointers: Record<string, string>;
  documents: Record<string, CollectionData>;
}
```

---

## Schemas (`@lisachandra/core/schemas`)

Character validation schemas for `@rbxts/validate-tree`. Used to verify character model structure before interacting with it.

```ts
import { schemas, Character, Humanoid } from "@lisachandra/core/schemas";

// Validate a character model
const character = waitForCharacter(model);
// character is typed as Character (R6Character)

// Schema objects
schemas.humanoid;    // Humanoid validation schema
schemas.r6Character; // R6 body schema
schemas.r15Character;// R15 body schema
```

---

## Utility Modules

### `utils/math`

```ts
import { average, closest, farthest, percentage, round, smoothstep, weightRandom, getServerClock } from "@lisachandra/core/utils/math";

getServerClock();  // Synced server time (works client-side)
round(3.14159, 2); // 3.14
smoothstep(0, 1, 0.5);  // 0.5
weightRandom(10, 20, 70); // Random weighted index
```

### `utils/vector`

```ts
import { reflect, distance } from "@lisachandra/core/utils/vector";

const reflected = reflect(surfaceNormal, bulletDirection);
const dist = distance(vecA, vecB);
```

### `utils/cframe`

```ts
import { distance } from "@lisachandra/core/utils/cframe";

const dist = distance(cfA, cfB);
```

### `utils/color`

```ts
import { iterativeLerpColorArray } from "@lisachandra/core/utils/color";

const blended = iterativeLerpColorArray([red, green, blue], 0.5);
```

### `utils/asset`

```ts
import { getSoundFromId, getAnimationFromId, getSoundGroupFromId } from "@lisachandra/core/utils/asset";

const sound = getSoundFromId(42);
const anim = getAnimationFromId(100);
```

### `utils/string`

```ts
import { toPascalCase, toCamelCase, formatTable, includes } from "@lisachandra/core/utils/string";

toPascalCase("hello_world"); // "Hello_world"
formatTable(myData, "Long"); // Formatted string
```

### `utils/type`

```ts
import { is, iterate, force, flow, required, getMember, inspect } from "@lisachandra/core/utils/type";

// Iterate with type-safe key/value pairs
for (const [key, value] of iterate(myTable)) { }

// Type narrowing guard
if (is<string>(value)) { /* value is string */ }

// Conditional flow control
for (const _ of flow(shouldRun)) {
  // Only executes when shouldRun is true
}
```

### `utils/main`

```ts
import {
  waitForCharacter, waitForDocument, loadAnimation,
  lazyConnect, lazyDisconnect, tween, catcher,
  getHumanoid, applyHumanoidDescription
} from "@lisachandra/core/utils/main";

// Validate and wait for a character model
const character = await waitForCharacter(model);

// Load an animation with caching
const { track, cached } = await loadAnimation(humanoid, animation);

// Tween helper
await tween(RunService.Heartbeat, tweenInfo, (progress) => {
  // progress goes 0..1
});

// Catch errors safely
promise.catch(catcher);
```

### `utils/vfx`

```ts
import { playVFX, animatedVFX, weldTo } from "@lisachandra/core/utils/vfx";

// Simple VFX playback
const clone = playVFX(vfxAsset, cf, optionalWeldPart);

// Animation-linked VFX
animatedVFX(character, animationTrack, vfxPart);
```

### `utils/r6ik` (Luau)

```ts
import R6IK from "@lisachandra/core/utils/r6ik";

const ik = new R6IK(character);
ik.ArmIK("Left", targetPosition);
ik.LegIK("Right", targetPosition);
```

### `utils/formatTable` (Luau)

```ts
import formatTable from "@lisachandra/core/utils/formatTable";

print(formatTable.formatTable(data, formatTable.formatMode.long));
```
