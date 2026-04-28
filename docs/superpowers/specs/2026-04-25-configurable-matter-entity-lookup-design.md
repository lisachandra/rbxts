# Configurable Matter Entity Lookup Design

**Date:** 2026-04-25
**Scope:** `packages/matter` package code outside `src/systems/**`

## Goal

Remove hardcoded game-specific component priority from package-level entity lookup helpers and replace it with user-configurable lookup order.

## Current Problem

`packages/matter` currently assumes entities are represented by a fixed priority of components such as `Profile`, `Items`, `Node`, and `NPC`. That assumption appears in package utilities like:

- `packages/matter/src/utils/entity.ts`
- `packages/matter/src/start.ts`

This makes the package depend on one game's component model and prevents consumers from defining their own preferred component order.

## Constraints

- Do not refactor `packages/matter/src/systems/**` yet.
- Keep the change package-local and minimal.
- Preserve current behavior by default where practical so existing consumers do not break unexpectedly.
- Make the lookup order configurable through a runtime API, not by mutating exported state directly.

## Proposed Design

Add a package-level runtime configuration for entity lookup.

### Public API

Expose a function from `packages/matter`:

```ts
configureEntityLookup({
	components: [
		getComponent("Profile"),
		getComponent("Items"),
		getComponent("Node"),
		getComponent("NPC"),
	],
});
```

The `components` array defines the lookup priority in order. The package uses that array whenever it needs to resolve an entity to a Roblox instance or position.

### Internal Model

Introduce one shared lookup module responsible for:

- Storing the current ordered list of entity lookup components
- Providing a default ordered list that matches existing package behavior
- Resolving the first component present on an entity by iterating the configured list
- Converting a resolved component into the corresponding Roblox object

This removes duplicated fallback chains from multiple call sites.

## Files Affected

- Add `packages/matter/src/entityLookup.ts`
- Modify `packages/matter/src/utils/entity.ts`
- Modify `packages/matter/src/start.ts`
- Modify `packages/matter/src/index.ts`

## Behavior

### Default behavior

If the user does not configure anything, entity lookup keeps the existing non-system order:

1. `getComponent("Profile")`
2. `getComponent("Items")`
3. `getComponent("Node")`
4. `getComponent("NPC")`

### Configured behavior

If the user calls `configureEntityLookup`, the package iterates the user-supplied array in order and returns the first matching component instance for the entity.

### Out of scope

- Replacing game-specific assumptions inside `packages/matter/src/systems/**`
- Changing unrelated component-specific logic such as `ownsEntity`, `isAlive`, or `getEntityHumanoid`
- Adding persistence for runtime config

## Error Handling

The configuration API should accept an empty array. In that case entity instance lookup returns `undefined` because no component types are eligible.

Unknown component-to-instance mappings are not part of the initial API. The first version stays minimal and supports the current component set already handled by `getComponentObject`.

## Testing Strategy

At minimum, verify that:

- The package still builds after the refactor
- Existing default behavior remains intact
- Reordered configured lookup changes which component is preferred by `getEntityObject`, `getEntityPosition`, and `findInstanceFromEntity`

## Rationale

A runtime API is the smallest change that removes package-level game assumptions without threading config through every call site. Centralizing lookup logic also makes later system cleanup easier because the package will already have one canonical source of entity resolution behavior.
