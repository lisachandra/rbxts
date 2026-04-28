# Matter package replication cleanup design

## Summary

This design narrows the `@lisachandra/matter` composition surface to the parts that are present in the current tree and still carry architectural value.

The main change is to make package-driven replication install codecs directly into the network registry instead of flowing through an intermediate replication-builder abstraction. The pipeline stays as the composition engine for systems, while direct system arrays remain the lightweight path for bootstrap consumers.

This design is based only on files that currently exist under `packages/matter/src/`.

## Current state

The current codebase already has the central runtime pieces needed for the desired architecture:

- `packages/matter/src/start.ts` is the runtime entry point used by the platform path.
- `packages/matter/src/network/registry.ts` owns codec registration and lookup.
- `packages/matter/src/network/messaging.ts` and `packages/matter/src/network/builtins/` provide the active replication runtime.
- `packages/matter/src/packages/` provides package graph resolution plus runtime assembly.
- `packages/matter/src/pipeline/createPipeline.ts` provides system composition.

Two places still reflect an older replication-composition model:

1. `packages/matter/src/packages/types.ts` exposes package replication as a structure that still mixes codec registration with template-style system registration.
2. `packages/matter/src/packages/createPackageRuntime.ts` aggregates package replication and pipeline data together, including `replication.templates`, even though codec installation is already performed through the network registry.

The current tree does not include the previously-mentioned `src/templates.ts`, `src/replication/`, or `src/pipeline/registerTemplateFamilies.ts`. This design therefore treats those as already absent and does not invent deletion work for them.

## Goals

1. Keep the active runtime paths that exist today.
2. Make package replication register codecs directly with the network registry.
3. Preserve pipeline-based system composition for package runtimes.
4. Preserve direct flat-system bootstrap usage.
5. Remove dead or misleading API surface from the current tree only.

## Non-goals

- No new `getComponent()` migration work.
- No `ComponentTypeMap` or module-augmentation refactor in this change.
- No speculative cleanup for files not present in the repository.
- No unrelated refactors to systems, hooks, items, or runtime adapters.

## Target architecture

After cleanup, the package runtime should have two clear responsibilities:

1. Build systems through the pipeline.
2. Install replication codecs directly into the shared registry.

That yields two supported composition paths:

### Path A: direct systems

Consumers provide a flat array of systems to bootstrap/start.

- No template-family wrapper is required.
- No replication builder is involved.

### Path B: package runtime

Consumers resolve package dependencies, create a runtime, install codecs, then build systems.

Conceptually:

```ts
const runtime = createPackageRuntime(resolved);
runtime.installCodecs(registry);
const systems = runtime.buildSystems();
```

The pipeline remains internal to package composition, and codec installation is explicit and direct.

## File-by-file design

### `packages/matter/src/packages/types.ts`

Rework `MatterPackageReplication` so it represents direct codec contribution rather than a legacy mixed abstraction.

Design decisions:

- Keep `codecs?: ReadonlyArray<ReplicationCodecRegistration>`.
- Remove `templates?: ReadonlyArray<SystemTemplate>`.
- Keep package pipeline contributions under the existing top-level `pipeline?: ReadonlyArray<PipelineRegistration<TSystem>>` field instead of duplicating them under replication.
- Keep `MatterPackageRuntime.installCodecs(registry)` as the public runtime hook.
- Keep `replicationComponents` typed as codec registrations, unless renaming is needed for clarity during implementation.

Result:

- Package metadata becomes easier to reason about.
- Replication only describes replication.
- System composition stays in the pipeline domain.

### `packages/matter/src/packages/createPackageRuntime.ts`

Rework runtime assembly so package replication contributes only codec registrations.

Design decisions:

- Continue collecting `pkg.pipeline ?? []` into `pipelineRegistrations`.
- Stop reading `pkg.replication?.templates`.
- Continue collecting `pkg.replication?.codecs ?? []` into the runtime codec list.
- Keep `installCodecs(registry)` and have it call `registry.register(codecRegistration)` for each contributed codec.

Result:

- The runtime aligns with the actual network registry architecture.
- There is no hidden second path for systems through replication metadata.
- The public runtime API matches the intended composition model.

### `packages/matter/src/packages/index.ts`

Review the barrel and remove any exports that only exist to support the old mixed replication/template abstraction, if present in the current tree.

### `packages/matter/src/index.ts`

Review root exports and remove any exports that become dead after the package cleanup, limited strictly to symbols that exist today.

No export removal should break active runtime modules that still exist in the current tree.

## Data flow after cleanup

### Package codec flow

1. A package contributes codec registrations in `replication.codecs`.
2. `createPackageRuntime()` aggregates those registrations from resolved packages.
3. `runtime.installCodecs(registry)` registers each codec directly into `packages/matter/src/network/registry.ts`.
4. Replication systems continue consuming the shared registry without any extra builder layer.

### Package system flow

1. A package contributes pipeline registrations through `pipeline`.
2. `createPackageRuntime()` aggregates those registrations.
3. `runtime.buildSystems()` passes them through `createPipeline()`.
4. The caller passes the resulting flat system array into bootstrap/start.

These flows stay separate and explicit.

## Error handling and compatibility

- `installCodecs(registry)` should continue to fail naturally if duplicate or invalid codec registrations violate registry expectations.
- Existing built-in codec registration under `packages/matter/src/network/builtins/` remains unchanged.
- Existing replication manager behavior remains unchanged except for consuming the same registry data it already uses.
- Existing package callers that rely on `replication.templates` will need to move those entries to `pipeline`, because that is the correct domain after cleanup.

## Testing and verification expectations

Implementation should verify at least the following:

1. Type-check package runtime changes affecting `MatterPackageReplication`.
2. Confirm that package runtimes still build systems successfully.
3. Confirm that codec installation still registers package codecs into the shared registry.
4. Confirm that root/package barrels remain valid after cleanup.

The implementation step should run repository-appropriate verification commands before completion.

## Assumptions

- The user-approved scope supersedes earlier discussion about additional component typing refactors.
- `getComponent()` replacements are already complete and out of scope.
- Missing files mentioned in earlier planning were already removed previously or are otherwise not part of the current checkout.

## Risks

1. Some downstream code may still be constructing package replication data with `templates` instead of `pipeline`.
2. Barrels may export symbols that appear unused locally but are consumed externally.
3. Renaming runtime properties for clarity could create avoidable churn if not kept minimal.

Mitigation:

- Prefer minimal API changes beyond removing the mixed replication-template shape.
- Keep runtime method names aligned with the current direct-registry architecture.
- Audit current in-repo references before deleting exports.

## Implementation boundaries

This design authorizes changes only in the currently existing matter package files needed to:

- simplify package replication typing,
- simplify package runtime aggregation,
- and remove now-dead exports tied to that obsolete shape.

It does not authorize broader architectural rewrites.
