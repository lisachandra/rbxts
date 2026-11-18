# Offline Runtime Spike — parity ledger

The default test lane runs compiled Luau inside `ree`
(roblox-engine-emulator) instead of Roblox Studio. That trades startup cost
and a Studio dependency for a reimplementation that does not implement the
whole engine. This file is the ledger of where the two disagree.

Packages are published from this repo, so a spec that reaches outside the
emulated surface is a signal that the package under test depends on an engine
feature — record it here rather than hiding it in a skipped test.

## What ree emulates

- The DataModel tree, `Instance` construction and property access.
- Signals, the scheduler, `task.*`, and virtual time with `RunService` frame
  phases.
- `require` over a Rojo project, including `WaitForChild`.
- Attributes.

## What ree does not emulate

- Remotes and networking.
- `HttpService` requests.
- Physics beyond free fall.
- `ReflectionService:GetClasses()` — `scripts/emulator/reflection.json`
  supplies a static copy for staging (see `scripts/emulator/README.md`).
- Studio-only services and the DataModel services that back them.
- **DataModel instance-lifecycle signals.** `Workspace.DescendantAdded` and
  `Workspace.DescendantRemoving` connect without error but never fire when an
  instance is parented or unparented in a spec. This is why `useStream`
  (`packages/matter/src/hooks/useStream.ts`) has no spec: its whole contract
  is "yield an event when an instance carrying the attribute enters the
  workspace", and the entering never happens. A Studio lane run is the only
  way to exercise it. The same gap covers `ChildAdded`, `AncestryChanged`
  and friends — a spec that needs them should go to `reeParityPaths` only
  if it aborts the run; if it merely cannot observe the event, say so in
  its header comment like `useStream`'s would.
- **A serverDataModel.** ree's `--mode play|edit` boots a _client_ context:
  `RunService:IsClient()` is `true` and `IsServer()` is `false` in both modes,
  and `--player` does not change it. The emulator backend hardcodes
  `--mode play`, so no spec can observe a server context. Code gated on
  `RunService.IsServer()` takes its client branch (or, for a hard
  `Log.Fatal` guard, aborts the suite).

## Container folders need scaffolding

The backend stages only `$path` mounts, so a container a Rojo project
declares as a bare `$className` folder (`ReplicatedStorage.Models.Items`,
`Workspace.Caches.Sound`) never reaches the stage — a module indexing it at
require time dies with `<Name> is not a valid member of ...`.

`scripts/luau/scaffoldContainers.luau` serialises those folders to
`<Service>.rbxm` bundles, and `emulator.snapshotsDirectory` points ree at
them. Run `pnpm ui:templates` after changing a test project's Rojo tree; it
walks every `test/*/default.project.json` and writes each project's own
`build/ui-templates`.

## Working with a parity gap

A spec that fails only on the emulator is a **parity gap**, not a broken test.

1. Reproduce with a targeted run:
   `pnpm --filter @lisachandra/test-<name> test --testPathPattern "<path>"`.
2. Confirm the spec passes on real Roblox (Studio lane, `--backend studio`).
3. Add the spec path to `reeParityPaths` in `jest.shared.ts`, with a one-line
   comment saying what ree does not do.
4. Add an entry here: the spec, the symptom, what it needs, and whether an
   upstream ree fix would remove it.

## Ledger

Recorded 2026-11-11 by running every project on the emulator lane.

| Spec                                        | Symptom                                                                                                          | Needs                                                                   | Upstream fix?                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| `test/core/src/utils.spec.ts`               | `WaitForDocument() must be called from the server!` — the suite's only test never runs                           | `RunService:IsServer()`                                                 | Yes — a server context in ree |
| `test/core/src/store.spec.ts` (`documents`) | `expect.assertions(2)` / deep-equality mismatch — the `store.documents` middleware is only installed server-side | `RunService:IsServer()`                                                 | Yes — a server context in ree |
| `test/platform/src/documentCommand.spec.ts` | Run yields with no output — the command calls `waitForDocument`, which fatals off-server                         | `RunService:IsServer()`                                                 | Yes — a server context in ree |
| `test/demo/src/client/ui/app.spec.tsx`      | `attempt to index nil with 'query'` — `store.world` is nil                                                       | a Matter world, which only a bootstrap creates; the spec never runs one | No — spec-level setup         |

Not in the table, because there is nothing to exclude: a spec for `useStream`
(`packages/matter/src/hooks/useStream.ts`) cannot be written on this lane at
all. `Workspace.DescendantAdded` connects but never fires (see the
instance-lifecycle gap above), so the stream-in path has no observable. It
needs the Studio lane.

Everything else passes. The counts move as suites land: `test/matter` is at
20 files / 138 tests, `test/ui` went from zero specs to six files / 77 tests
(2026-11-18), and `test/core` and `test/platform` cover their respective
surfaces.
