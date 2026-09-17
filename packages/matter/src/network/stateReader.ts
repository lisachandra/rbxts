import { store } from "@lisachandra/core/store";
import type { AnyEntity, Component } from "@rbxts/matter";
import { RunService } from "@rbxts/services";

import type { ComponentKey } from "../components";
import { Components } from "../components";

/**
 * Provides a seam for replication codecs to read application state without depending directly on
 * the global store singleton.
 *
 * @remarks
 *   Production code uses {@link StoreCodecStateReader} (via {@link defaultStateReader}), which
 *   resolves the side-appropriate crate and the Matter world. Tests can inject an
 *   {@link InMemoryCodecStateReader} to exercise codecs without touching the store.
 */
export interface CodecStateReader {
	/**
	 * Returns the GUID-to-numeric mapping shared by the network layer.
	 *
	 * @remarks
	 *   Both the client and server crates store `itemGUIDMap: Record<string, number>`.
	 * @returns The current item GUID map.
	 */
	getItemGUIDMap(): Record<string, number>;

	/**
	 * Returns the component instance for an entity, if present.
	 *
	 * @typeParam T - The component key type.
	 * @param entityId - The entity to look up.
	 * @param componentKey - The component key to read.
	 * @returns The component instance, or `undefined` when the entity has no such component.
	 */
	getComponent<T extends ComponentKey>(
		entityId: AnyEntity,
		componentKey: T,
	): N<Component<object>>;
}

/**
 * Production {@link CodecStateReader} that delegates to the global store crater and world.
 *
 * @remarks
 *   `getItemGUIDMap` reads the client crate when the code runs on the client and the server crate
 *   otherwise, mirroring how the item codecs previously read `store.client`/`store.server`
 *   directly.
 */
export class StoreCodecStateReader implements CodecStateReader {
	public getItemGUIDMap(): Record<string, number> {
		if (RunService.IsClient()) {
			return (store.client.getState("itemGUIDMap") ?? {}) as Record<string, number>;
		}

		return (store.server.getState("itemGUIDMap") ?? {}) as Record<string, number>;
	}

	public getComponent<T extends ComponentKey>(
		entityId: AnyEntity,
		componentKey: T,
	): N<Component<object>> {
		if (!store.world || !store.world.contains(entityId)) {
			return undefined;
		}

		return store.world.get(entityId, Components[componentKey] as never) as N<Component<object>>;
	}
}

/** The default {@link CodecStateReader} used by production replication codecs. */
export const defaultStateReader: CodecStateReader = new StoreCodecStateReader();

/**
 * Test {@link CodecStateReader} backed by in-memory maps.
 *
 * @remarks
 *   Construct with a `guidMap` and, optionally, per-entity component fixtures. Use
 *   {@link setComponent} to add components for entities the codec is expected to read.
 */
// oxlint-disable-next-line typescript/max-classes-per-file -- paired production/test adapters for one seam
export class InMemoryCodecStateReader implements CodecStateReader {
	constructor(
		private readonly guidMap: Record<string, number> = {},
		private readonly components = new Map<
			AnyEntity,
			Partial<Record<ComponentKey, Component<object>>>
		>(),
	) {}

	public getItemGUIDMap(): Record<string, number> {
		return this.guidMap;
	}

	public getComponent<T extends ComponentKey>(
		entityId: AnyEntity,
		componentKey: T,
	): N<Component<object>> {
		return this.components.get(entityId)?.[componentKey] as N<Component<object>>;
	}

	/**
	 * Adds or replaces a component fixture for an entity.
	 *
	 * @typeParam T - The component key type.
	 * @param entityId - The entity to attach the component to.
	 * @param componentKey - The component key.
	 * @param comp - The component instance to store.
	 */
	public setComponent<T extends ComponentKey>(
		entityId: AnyEntity,
		componentKey: T,
		comp: Component<object>,
	): void {
		let entityMap = this.components.get(entityId);
		if (!entityMap) {
			entityMap = {};
			this.components.set(entityId, entityMap);
		}

		entityMap[componentKey] = comp;
	}
}
