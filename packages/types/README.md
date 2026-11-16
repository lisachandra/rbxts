# @lisachandra/types

Global type declarations that make working with Roblox APIs concise. Install it and add it to
`compilerOptions.types` once; the improvements then apply everywhere with no imports.

```json
{ "types": ["../@rbxts/types", "../@lisachandra/types"] }
```

## Typed instance lookups

The main win. Roblox's lookup methods return `Instance | undefined`, which means a cast at every call
site. These overloads take the type you expect instead:

```ts
const handle = model.FindFirstChild<BasePart>("Handle"); // BasePart | undefined
const humanoid = character.WaitForChild<Humanoid>("Humanoid"); // Humanoid, no cast
const part = instance.GetAttribute<BasePart>("Part"); // BasePart | undefined
```

`WaitForChild` returns `T` when it blocks and `N<T>` when you pass a timeout. `FindFirstAncestor` and
`FindFirstDescendant` work the same way.

## `N<T>`

`T | undefined` under a shorter name, used consistently across the suite so optional returns read the
same everywhere.

```ts
function findPlayer(name: string): N<Player> {}
```

## Service layout

`Workspace`, `ReplicatedStorage`, `SoundService`, and `Players` are augmented with the folder structure
the library expects, so `Workspace.Nodes` and `ReplicatedStorage.UI` type-check without a lookup:

```ts
Workspace.Characters; // Folder
Workspace.NPCs; // Folder
Workspace.Caches.Sound; // Folder
ReplicatedStorage.HumanoidDescriptions; // Folder
SoundService.Master; // SoundGroup
Players.Hotbars; // Folder
```

## Matter system metadata

Adds `phase`, `placeIds`, `priority`, and `after` to `SystemStruct`, so a system's `meta` export is
checked — a typo in a phase name is a compile error rather than a system that never runs:

```ts
export const meta = {
	phase: "preSimulation",
	system: mySystem,
} satisfies SystemStruct<[World]>;
```

Valid phases are the run-service events (`default`, `stepped`, `heartbeat`, `preSimulation`,
`postSimulation`, `preRender`, `preAnimation`, `renderStepped`), the five render priorities
(`renderFirst`, `renderInput`, `renderCamera`, `renderCharacter`, `renderLast`), and
`playerModuleCamera`. There is no `Hz*` phase.

`World` also gains `startDeferring()` / `stopDeferring()`.

## Feature flags

`_G` declares the flags a build may define: `__DEV__`, `__PROD__`, `__TEST__`, `__PROFILE__`,
`__COMPAT_WARNINGS__`, `__EXPERIMENTAL__`, `__VERSION__`, `__REACT_MICROPROFILER_LEVEL__`, and
`NOCOLOR`. All are optional, so reading one never needs a guard for existence — only for its value.
