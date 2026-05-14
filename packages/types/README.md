# @lisachandra/types

Global type declarations and augmentations for Roblox services. This is the **leaf package** with no internal dependencies — all other `@lisachandra` packages depend on it.

## Install

```bash
pnpm add @lisachandra/types
```

Peer dependencies:
```json
{
  "type-fest": "*",
  "@rbxts/types": "*",
  "@rbxts/compiler-types": "*",
  "@rbxts/matter": "*"
}
```

## What It Provides

### Global Type `N<T>`

A shorthand for optional values. Equivalent to `T | undefined`.

```ts
type N<T> = T | undefined;
```

Usage:
```ts
import type { N } from "@lisachandra/types";

const value: N<number> = 42;   // ok
const missing: N<number> = undefined; // ok
```

### Global Type `Table`

Represents any Lua table.

```ts
type Table = Record<number | string | symbol, unknown>;
```

### Global Type `IsNominal<T>`

Checks whether an object type has Flavor-branded nominal keys.

```ts
type IsNominal<T> = Exclude<keyof T, ExcludeNominalKeys<T>> extends never ? false : true;
```

### `_G` Global Augmentations

Globally-available feature flags:

| Property | Type | Purpose |
|---|---|---|
| `__COMPAT_WARNINGS__` | `boolean?` | Enable compatibility warnings |
| `__DEV__` | `boolean?` | Development mode flag |
| `__EXPERIMENTAL__` | `boolean?` | Enable experimental features |
| `__PROD__` | `boolean?` | Production mode flag |
| `__PROFILE__` | `boolean?` | Enable profiling |
| `__REACT_MICROPROFILER_LEVEL__` | `IntRange<0, 11>?` | React microprofiler level |
| `__TEST__` | `boolean?` | Test environment flag |
| `__VERSION__` | `` `${number}.${number}.${number}`? `` | Semantic version string |
| `NOCOLOR` | `boolean?` | Disable colored output |

### `LuaGlobals` Augmentations

```ts
declare global {
  interface LuaGlobals {
    /** Lua `unpack` with typed return. */
    unpack: <T extends Array<unknown>>(...args: T) => T;
    /** Lua `setfenv` with typed signature. */
    setfenv: (func: Callback, fenv: Table) => void;
  }
}
```

### Instance Augmentations

Every `Instance` gets type-safe, generic versions of common methods:

| Method | Enhancement |
|---|---|
| `FindFirstAncestor<T>(name)` | Returns `N<T>` (typed ancestor) |
| `FindFirstDescendant<T>(name)` | Returns `N<T>` (typed descendant) |
| `GetAttribute<T>(name)` | Returns `N<T>` instead of `AttributeValue` |
| `WaitForChild<T>(name)` | Returns `T` (blocking) or `N<T>` (timeout overload) |
| `FindFirstChild<T>(name)` | Returns `N<T>`, with a generic overload for known keys |

Example:
```ts
const part = model.FindFirstChild<BasePart>("Handle");
// part: BasePart | undefined (typed!)
```

### Service Augmentations

Typed children for standard Roblox services:

**`Workspace`:**
```ts
interface Workspace {
  Map: Folder;
  Characters: Folder;
  NPCs: Folder;
  Items: Folder;
  Nodes: Folder;
  Caches: Model & { Sound: Folder };
}
```

**`ReplicatedStorage`:**
```ts
interface ReplicatedStorage {
  Animations: Folder & { Tools: Folder };
  Models: Folder & { Items: Folder; Tools: Folder };
  UI: Folder;
  Tools: Folder;
  VFX: Folder;
  HumanoidDescriptions: Folder;
}
```

**`SoundService`:**
```ts
interface SoundService {
  Sounds: Folder;
  Master: SoundGroup;
}
```

**`Players`:**
```ts
interface Players {
  Hotbars: Folder;
}
```

### Matter `SystemStruct` Augmentation

Adds `phase?` support with Roblox-specific phase names:

```ts
type PhaseName =
  | "Hz1" | "Hz5" | "Hz10" | "Hz15" | "Hz30" | "Hz60"
  | "stepped" | "heartbeat"
  | "preRender" | "renderLast" | "renderFirst"
  | "renderInput" | "preAnimation" | "renderCamera"
  | "renderStepped" | "preSimulation" | "postSimulation"
  | "renderCharacter" | "playerModuleCamera";
```

Also augments `World` with `startDeferring()` and `stopDeferring()`.

### RuntimeLib

Luau runtime bridge providing async utilities, generators, module loading, and error handling:

```ts
declare const RuntimeLib: RuntimeLib;
```

| Member | Description |
|---|---|
| `RuntimeLib.Promise` | Promise constructor |
| `RuntimeLib.TRY_BREAK / TRY_CONTINUE / TRY_RETURN` | Try-control flow constants (2, 3, 1) |
| `RuntimeLib.async(fn)` | Wraps a callback as a Promise-returning function |
| `RuntimeLib.await(promise)` | Await a Promise or pass through non-Promise values |
| `RuntimeLib.bit_lrsh(a, b)` | Logical right shift |
| `RuntimeLib.generator(fn)` | Wrap a generator function |
| `RuntimeLib.getModule(context, scope, name)` | Require a ModuleScript |
| `RuntimeLib.import(context, module, ...path)` | Import from a module |
| `RuntimeLib.instanceof(obj, class)` | Runtime `instanceof` check |
| `RuntimeLib.reset()` | Reset the runtime |
| `RuntimeLib.try(tryFn, catchFn?, finallyFn?)` | Try/catch/finally returning `LuaTuple<[number?, ...T]>` |
