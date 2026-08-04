import type { AnyEntity, Component, World } from "@rbxts/matter";
import type { ComponentCtor } from "@rbxts/matter/lib/component";

import type { ComponentKey } from "./components";
import { Components } from "./components";

type MatterComponentFactory = ComponentCtor;

export type EntityLookupComponentName = ComponentKey;

export interface EntityLookupConfig {
	humanoidComponents?: ReadonlyArray<EntityLookupComponentName>;
	instanceComponents?: ReadonlyArray<EntityLookupComponentName>;
}

const defaultInstanceComponents: Array<EntityLookupComponentName> = ["Profile", "Items", "Node"];

const defaultHumanoidComponents: Array<EntityLookupComponentName> = ["Profile"];

let entityInstanceComponents = [...defaultInstanceComponents];
let entityHumanoidComponents = [...defaultHumanoidComponents];

export function configureEntityLookup(config: EntityLookupConfig): void {
	if (config.instanceComponents !== undefined) {
		entityInstanceComponents = [...config.instanceComponents];
	}

	if (config.humanoidComponents !== undefined) {
		entityHumanoidComponents = [...config.humanoidComponents];
	}
}

export function getEntityInstanceComponents(): ReadonlyArray<EntityLookupComponentName> {
	return entityInstanceComponents;
}

export function getEntityHumanoidComponents(): ReadonlyArray<EntityLookupComponentName> {
	return entityHumanoidComponents;
}

export function getEntityLookupComponent(
	name: EntityLookupComponentName,
): undefined | MatterComponentFactory {
	return Components[name];
}

export function getEntityComponentByName(
	world: World,
	entityId: AnyEntity,
	name: EntityLookupComponentName,
): undefined | Component<object> {
	const component = getEntityLookupComponent(name);
	return component !== undefined ? world.get(entityId, component as never) : undefined;
}

function getEntityComponentFromList(
	world: World,
	entityId: AnyEntity,
	componentNames: ReadonlyArray<EntityLookupComponentName>,
): undefined | Component<object> {
	for (const componentName of componentNames) {
		const resolved = getEntityComponentByName(world, entityId, componentName);
		if (resolved !== undefined) {
			return resolved;
		}
	}

	return undefined;
}

export function getEntityInstanceComponent(
	world: World,
	entityId: AnyEntity,
): undefined | Component<object> {
	return getEntityComponentFromList(world, entityId, entityInstanceComponents);
}

export function getEntityHumanoidComponent(
	world: World,
	entityId: AnyEntity,
): undefined | Component<object> {
	return getEntityComponentFromList(world, entityId, entityHumanoidComponents);
}

/**
 * Streamable entity lookup configuration.
 *
 * Defines which components are used to identify an entity as "streamable" (i.e., eligible for
 * network streaming between server and client).
 *
 * **Important:** Streamable components MUST include a `model` key of type `Instance`. The streaming
 * system (`clientStreamer.ts`) casts the matched component to `Component<{ model: Instance }>` to
 * track the associated Roblox instance during streaming events. Components without a `model` field
 * will cause a type mismatch at the call site.
 *
 * @example
 * 	```ts
 * 	configureStreamableEntityLookup({
 * 		components: ["Items", "NPC", "Vehicle"],
 * 	});
 * 	```;
 */
export interface StreamableEntityLookupConfig {
	components?: ReadonlyArray<EntityLookupComponentName>;
}

const defaultStreamableComponents: Array<EntityLookupComponentName> = ["Items"];

let streamableComponents = [...defaultStreamableComponents];

/**
 * Configures which components are used for streamable entity lookup.
 *
 * Each component name listed here must correspond to a Matter component whose data shape includes a
 * `model: Instance` key. This constraint is required by `clientStreamer.ts`, which casts the
 * resolved component to `Component<{ model: Instance }>` for tracking the associated Roblox
 * instance.
 *
 * @param config - Configuration object specifying the components to use.
 */
export function configureStreamableEntityLookup(config: StreamableEntityLookupConfig): void {
	if (config.components !== undefined) {
		streamableComponents = [...config.components];
	}
}

/** Returns the current list of component names used for streamable entity lookup. */
export function getStreamableComponents(): ReadonlyArray<EntityLookupComponentName> {
	return streamableComponents;
}

/**
 * Resolves a streamable component for the given entity. Returns the first matching component from
 * the configured streamable component list.
 *
 * @param world - The Matter world instance.
 * @param entityId - The entity to look up.
 * @returns The first matching streamable component, or undefined if none found.
 */
export function getEntityStreamableComponent(
	world: World,
	entityId: AnyEntity,
): undefined | Component<object> {
	return getEntityComponentFromList(world, entityId, streamableComponents);
}
