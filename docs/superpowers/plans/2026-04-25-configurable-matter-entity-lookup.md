# Configurable Matter Entity Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace package-level hardcoded entity component priority with a user-configurable runtime lookup order outside `src/systems/**`.

**Architecture:** Add one shared entity lookup module that owns ordered component configuration and first-match resolution. Refactor `start.ts` and `utils/entity.ts` to consume that shared resolver so package-level entity-instance lookup follows one configurable path.

**Tech Stack:** TypeScript, roblox-ts, `@rbxts/matter`

---

## File Structure

- Create: `packages/matter/src/entityLookup.ts`
  Responsibility: store the ordered component list, expose configuration, and resolve the first matching component for an entity.
- Modify: `packages/matter/src/utils/entity.ts`
  Responsibility: keep component-to-instance conversion logic and switch entity-level lookup helpers to the shared resolver.
- Modify: `packages/matter/src/start.ts`
  Responsibility: use the shared resolver for default `findInstanceFromEntity` behavior.
- Modify: `packages/matter/src/index.ts`
  Responsibility: export the new runtime configuration API.

### Task 1: Add shared entity lookup runtime config

**Files:**
- Create: `packages/matter/src/entityLookup.ts`

- [ ] **Step 1: Write the shared lookup module**

```ts
import type { AnyEntity, Component, World } from "@rbxts/matter";
import { Components } from "./components";

export type EntityLookupComponent =
	| typeof Components.Profile
	| typeof Components.Items
	| typeof Components.Node
	| typeof Components.NPC;

export interface EntityLookupConfig {
	components: ReadonlyArray<EntityLookupComponent>;
}

const defaultEntityLookupComponents: Array<EntityLookupComponent> = [
	Components.Profile,
	Components.Items,
	Components.Node,
	Components.NPC,
];

let entityLookupComponents = [...defaultEntityLookupComponents];

export function configureEntityLookup(config: EntityLookupConfig): void {
	entityLookupComponents = [...config.components];
}

export function getEntityLookupComponents(): ReadonlyArray<EntityLookupComponent> {
	return entityLookupComponents;
}

export function getEntityComponent(
	world: World,
	entityId: AnyEntity,
): Component<object> | undefined {
	for (const component of entityLookupComponents) {
		const resolved = world.get(entityId, component);
		if (resolved !== undefined) {
			return resolved;
		}
	}

	return undefined;
}
```

- [ ] **Step 2: Build the package to catch typing issues early**

Run: `pnpm --filter @lisachandra/matter build`
Expected: build completes or reports precise type errors in `entityLookup.ts`

### Task 2: Refactor package entity helpers to use shared lookup

**Files:**
- Modify: `packages/matter/src/utils/entity.ts`

- [ ] **Step 1: Replace hardcoded entity fallback chains with the shared resolver**

```ts
import { getEntityComponent } from "../entityLookup";

export function getEntityObject(entityId: AnyEntity = -1 as AnyEntity): N<PVInstance> {
	const world = store.world.contains(entityId) ? store.world : undefined;
	return world !== undefined ? getComponentObject(getEntityComponent(world, entityId)) : undefined;
}

export function getEntityPosition(entityId: AnyEntity = -1 as AnyEntity): N<Vector3> {
	const world = store.world.contains(entityId) ? store.world : undefined;
	return world !== undefined ? getComponentPosition(getEntityComponent(world, entityId)) : undefined;
}
```

- [ ] **Step 2: Build again after the refactor**

Run: `pnpm --filter @lisachandra/matter build`
Expected: build completes or reports only real integration errors

### Task 3: Refactor runtime instance lookup and export the API

**Files:**
- Modify: `packages/matter/src/start.ts`
- Modify: `packages/matter/src/index.ts`

- [ ] **Step 1: Update `start.ts` to use the shared entity resolver**

```ts
import { getComponentObject } from "./utils/entity";
import { getEntityComponent } from "./entityLookup";

export function findInstanceFromEntity(world: World, entityId: AnyEntity): N<Instance> {
	if (runtimeAdapters.findInstanceFromEntity) {
		return runtimeAdapters.findInstanceFromEntity(world, entityId);
	}

	return getComponentObject(getEntityComponent(world, entityId));
}
```

- [ ] **Step 2: Export the new configuration API from the package entrypoint**

```ts
export * from "./entityLookup";
```

- [ ] **Step 3: Run the package build for final verification**

Run: `pnpm --filter @lisachandra/matter build`
Expected: `rbxtsc` succeeds for `@lisachandra/matter`

- [ ] **Step 4: Inspect the diff before handing off**

Run: `git diff -- packages/matter/src docs/superpowers`
Expected: diff shows one new lookup module, two refactors using it, one export update, and the spec/plan docs
