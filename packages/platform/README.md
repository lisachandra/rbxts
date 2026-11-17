# @lisachandra/platform

The glue between a game and the rest of the suite: starting the client and server, admin commands,
player documents, and signed teleports. This is the package most games import from most often.

## Starting a game

`bootstrap()` is the entry point. It collects systems from three sources — an explicit list, Flamework
barrel modules, and Matter packages — merges them into one boundary, and starts the loop.

```ts
// main.server.ts
import { bootstrap } from "@lisachandra/platform";
import { builtinPackage } from "@lisachandra/matter/systems";

const { world, crate, loop } = bootstrap({
	mode: "development",
	modules: { server: serverSystems, shared: sharedSystems },
	packages: [builtinPackage],
});
```

```ts
// main.client.ts
bootstrap({
	modules: { client: clientSystems, shared: sharedSystems },
	packages: [builtinPackage],
});
```

Any module exported from a `modules` barrel with a `meta` export is picked up automatically, so systems
do not need registering one by one. `packages` is where `builtinPackage` goes; leaving it out is the
usual reason "none of the item or replication systems run".

`mode: "development"` enables Rewire hot reload, but only in Studio and only when you also pass
`hotReload.containers`. Outside Studio it has no effect.

## Admin commands

Importing the Centurion barrel registers the four bundled commands, their argument types, and their
guards:

```ts
import "@lisachandra/platform/centurion";
import { Centurion } from "@rbxts/centurion";

Centurion.server({}).start();
```

You get `teleport` (alias `tp`), `kick`, `document` (inspect a player's document; kicks them so it
reloads), and `set` (write item data by GUID, `string` and `number` values only).

### Commands are open unless you guard them

This is the one thing to read before adding a command. **Centurion has no default authorization.** A
command with no `@Guard` is runnable by any client, and Centurion's `syncFilter` default makes it
discoverable too. This package ships a guard but installs no default, so an unguarded command you add
is open.

Every bundled command uses `adminOrDeveloper`, and so should yours:

```ts
@Command({ name: "kick", arguments: [{ type: CenturionType.Players, name: "players" }] })
@Guard(adminOrDeveloper)
public kick(_: CommandContext, players: Array<Player>): void {}
```

```ts
import {
	configureCenturionGroup,
	configureCenturionRoles,
	configureCenturionUsers,
} from "@lisachandra/platform/centurion/guards";

configureCenturionGroup(1234567);
configureCenturionRoles(["Developer", "Founder"]); // the default
configureCenturionUsers([1, 2]); // user IDs that skip the role check
```

Roles match by full name, case-insensitively: `Developer` admits `developer` but never
`Junior Developer`. An empty role list denies everyone.

**The guard must return a boolean synchronously.** Centurion runs guards as
`if not guard(context) then return nil end`, so a guard returning a `Promise` is truthy and the command
executes — an async guard is a silent bypass, not an error. If your authorization needs a web call, do it
before the guard and store the result.

For anything beyond the shipped guard, `authorize(input, policy)` and `createAuthorizationPolicy(roles,
userIds)` are pure functions, so a policy can be tested without a running server.

### The convention is not enforced

Nothing rejects an unguarded command — not Centurion, not this package, not a lint rule. The guard
ships here and every bundled command uses it, but that is a reference implementation, not a control:
a consumer must not infer that an authorisation check exists because one is exported. **A command you
add is open until you add the guard.**

So check each new command against this list:

1. It carries `@Guard(adminOrDeveloper)`, or a guard built on `authorize` /
   `createAuthorizationPolicy`.
2. That guard returns a `boolean` synchronously, and a test drives it with a fake player — the
   registry-config spec is the pattern.
3. If it is meant to be runnable by anyone, that is a deliberate decision and worth a comment saying
   so; `help`-style commands are the only ones that usually qualify.
4. Its argument list cannot be used to write arbitrary data — inspect the four bundled commands
   (`kick`, `set`, `teleport`, `document`) before adding one that mutates state.
5. It appears in this README's command table, or is explicitly marked internal.

Both halves of the guard story matter: the guard has to _be_ synchronous, and Centurion has to
_evaluate_ it synchronously. `adminOrDeveloper` is typed to return `boolean`, but a guard whose body
returns a `Promise` types as `boolean` through a wider signature and executes anyway. `assertGuardsReturnBoolean`
in `@lisachandra/platform/centurion/testing` refuses that at construction: it halts on any return that is
not a `typeof` `"boolean"`, so a `Promise`, `nil`, or table cannot pass as truthy. Call it once in a test
with every guard you register.

### Custom argument types

```ts
import { CenturionUserType, registerCenturionType } from "@lisachandra/platform/centurion";

declare module "@lisachandra/platform/centurion/type" {
	interface CenturionUserTypes {
		Item: "item";
	}
}

registerCenturionType("Item", "item");
```

Both halves are needed for the same reason as custom components: the augmentation is compile-time, the
call is runtime. `makeListableType` and `makeEnumType` build list and choice types on top.

## Documents

Persistence is Dataforge. Create a store and tell Matter about it:

```ts
import dataforge from "@rbxts/dataforge";
import { configureRuntimeAdapters } from "@lisachandra/matter";

const store = dataforge.create_store<CollectionData>({
	name: "PlayerData",
	template: { hotbar: [], inventory: [] },
});

configureRuntimeAdapters({ document: { store } });
```

The document config accepts only `store`; `collection` is a deprecated alias kept for transitional
compatibility. Which key you pass is the invariant in #26: it decides both the handle the middleware
writes through and what a test store has to provide. Persistence is not opt-in per component: whatever
your game puts into `store.documents` is what the middleware writes.

Writes reach the datastore through the store's `documents` middleware, which pushes changed entries into
their Dataforge profiles — updating `store.documents` is the operation, so no separate save call exists.
Only entries whose contents changed are written, so re-assigning an unchanged document is not a write.

### Nothing validates on load

**No validation runs on the load path.** `createDataStoreValidator<T>()` builds a Boba validator, but
nothing calls it: whatever shape is in the datastore is what your game receives.

Validation used to happen when Lapis backed the collection. It left with the Dataforge migration in #11,
and nothing replaced it — `createDataStoreValidator` stayed exported but unconnected, which is the part
that misleads: an exported validator reads like an installed one.

So validate where you consume the document, and decide the failure policy yourself — reject the player,
reset to the template, or quarantine the record:

```ts
import { createDataStoreValidator } from "@lisachandra/platform/document/validate";

const assertValid = createDataStoreValidator<CollectionData>();

const document = await loadDocument(player);
const [ok] = pcall(() => assertValid(document));
if (!ok) {
	// your recovery policy
}
```

Pass `true` as the first argument for the raw Boba validator instead of an asserting function, which is
what you want when you need a boolean rather than an assertion.

### Testing with documents

`createTestStore({ name, template })` returns `{ store, hook, scheduler }` using Dataforge's memory hook
and virtual scheduler, so tests exercise real store loads and writes without touching a DataStore.
Stepping the scheduler drives the deferred work to completion — nothing resolves until you step it.

## Teleports

Teleports carry a signed, expiring payload so a client cannot forge arrival data.

```ts
import {
	configureTeleport,
	configureTeleportSecret,
	isValidTeleport,
	serializeTeleportData,
	teleport,
} from "@lisachandra/platform/teleporter";

configureTeleport({ expiration: 300, attempts: 3, retry_delay: 1 });
configureTeleportSecret(secret); // must be the same in every participating place

const [ok, result] = await teleport(placeId, [player], serializeTeleportData({ fromLobby: true }));

// on arrival
const { success, validHash, unexpired } = isValidTeleport(player);
```

`teleport` retries up to `attempts` times, waiting `retry_delay` between tries. Keep the secret out of
source — read it from configuration — since anyone holding it can mint valid teleport data.

The secret is **required**: `isValidTeleport` halts, naming `configureTeleportSecret`, if none has been
configured, and `configureTeleportSecret` refuses a blank or whitespace-only value where you call it. A
place that never configured one used to verify tokens anyway, against `sha256(stamp)` — a hash anyone
can compute.

`serializeTeleportData` signs a canonical rendering of the **whole payload**, not just `stamp`, so any
field you add is authenticated. Two consequences worth knowing:

- The stamp's window is two-sided. A token older than `expiration` is rejected, and so is one whose
  stamp leads the receiving server's clock by more than 60 seconds, even when the signature is correct.
- Any change to a payload field invalidates the token. Mint a new one rather than patching a minted
  token in place.

The verification is available without a `Player` as `verifyTeleportData(data, now)`, and a token can be
minted without a `TeleportOptions` instance as `signTeleportData(payload, stamp)`. `isValidTeleport` is
the thin wrapper that reads the player's join data, so a test can drive the checks directly.
