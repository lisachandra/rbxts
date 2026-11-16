# @lisachandra/core

The runtime primitives the rest of the suite builds on: structured logging, a reactive store,
character validation, and the small helpers that otherwise get copy-pasted between games.

## Logging

`@rbxts/log` is the logging surface for the whole suite — `print`, `warn`, and `error` should not appear
outside the sink. This package wires the sink and keeps the recent history in memory for an on-screen
console.

```ts
import { configureLogger, logOutput, setupLogger } from "@lisachandra/core/logger";
import { LogLevel } from "@rbxts/log";

configureLogger({ defaultVersion: "1.2.3", isProduction: false, logLevel: LogLevel.Debugging });
setupLogger(); // once, at startup

for (const [time, message] of logOutput) {
	// last 128 lines, for a debug overlay
}
```

`isProduction: true` forces the level to `Information` regardless of `logLevel`, so a production build
cannot leak debug output by forgetting to change the level.

## Store

One `Crate` shared by every system, split into client, server, and shared views so each side reads only
what it can actually see.

```ts
import { store } from "@lisachandra/core/store";

store.client.getState("playerEntityId"); // this client's entity
store.server.getState("itemGUIDMap"); // server-only
store.shared.getState("itemPointers"); // both sides

store.world; // the Matter World, set by start()
store.diffSignal; // fires on every change
```

Two things live on the store beyond state: `store.documents` (server, loaded player documents) and
`store.hotbar` (server, the hotbar folder). Augment `CollectionData` to type the document payload your
game stores:

```ts
declare module "@lisachandra/core/store" {
	interface CollectionData {
		gold: number;
		stats: { level: number; xp: number };
	}
}
```

## Character validation

R6 and R15 schemas for `@rbxts/validate-tree`. `waitForCharacter` validates the tree and returns a
typed model, so downstream code can trust that `Humanoid` and `RootPart` exist:

```ts
import { waitForCharacter } from "@lisachandra/core/utils/main";

const character = await waitForCharacter(model); // throws on timeout or a malformed tree
```

It validates against `schemas.r6Character` only, and `Character` is that type — an R15 rig fails it.
For R15, validate with `schemas.r15Character` yourself (`schemas.humanoid` covers the humanoid alone).
All three are deeply frozen.

## Async helpers

`utils/main` covers the joins and waits that are awkward to write correctly:

```ts
import {
	catcher,
	loadAnimation,
	lazyConnect,
	tween,
	waitForDocument,
} from "@lisachandra/core/utils/main";

const { track, cached } = await loadAnimation(humanoid, animation); // cached per character

await tween(RunService.Heartbeat, tweenInfo, (progress) => {
	// progress runs 0 → 1
});

const connection = lazyConnect(part.Touched, () => {}); // skips the callback once disconnected
promise.catch(catcher()); // catcher() builds the handler, so it logs traceback plus error
```

`loadAnimation` returns `{ track, cached }` — the second call for the same character and animation
hands back the existing `AnimationTrack` instead of reloading it. `catcher` is a factory because it
captures a traceback at the point you call it, before the rejection surfaces.

`waitForDocument` needs to know how your game stores documents, since `core` cannot depend on the item
system. Register an accessor once:

```ts
import { configureDocumentAccessor } from "@lisachandra/core/utils/main";
import { store } from "@lisachandra/core/store";

configureDocumentAccessor((userId) => ({ document: store.documents[`Player_${userId}`] }));
```

## Small helpers

The remaining modules are single-purpose and short:

- **`utils/math`** — `getServerClock()` for a clock shared by client and server, plus `smoothstep`,
  `weightRandom`, `closest`, `round`, `average`, `farthest`, `percentage`.
- **`utils/type`** — `is<T>` for narrowing, `iterate` for typed `pairs`, `required` to strip
  optionality, `typeAssert` / `typeAssertIs` for assertions, and `flow(condition)`, which returns
  `[]` or `[symbol]` so a `for ... of flow(run)` body runs only when `run` is true.
- **`utils/string`** — `toPascalCase`, `toCamelCase`, their `is*` checks, `lookupKeyIgnoreCase`,
  `toPath`, `includes`, `formatTable`.
- **`utils/asset`** — `getSoundFromId`, `getAnimationFromId`, `getSoundGroupFromId`.
- **`utils/vector`** — `reflect`, `distance`; **`utils/cframe`** — `distance`; **`utils/color`** —
  `iterativeLerpColorArray`.
- **`utils/vfx`** — `playVFX`, `animatedVFX`, `weldTo`, `toggleAllDescendants`.
- **`utils/r6ik`** — `R6IK` for two-bone arm and leg IK on R6 rigs.
