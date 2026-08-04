/*
 * This system handles streaming of entities between the client and server. It
 * manages entity addition and removal, updates streaming states, and
 * synchronizes components. It ensures efficient and accurate entity streaming
 * for the game world.
 *
 * Streamable entities are identified via the configured streamable component
 * lookup (see `configureStreamableEntityLookup`). Any entity with a `Stream`
 * component plus a streamable component (which must have a `model: Instance`
 * key) will be handled by this system.
 */
import type { ClientState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { AnyEntity, Component, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { None } from "@rbxts/matter";

import { Components } from "../../../components";
import { getEntityStreamableComponent } from "../../../entityLookup";
import { useStream } from "../../../hooks";
import { findServerEntityIdFromMap } from "../../../utils/entity";

/*
 * Manages entity streaming for optimizing client-server synchronization.
 * Handles the addition and removal of streamed entities in the game world.
 * Updates entity states based on their streaming status (e.g., "in" or "out").
 *
 * Instead of hardcoding specific component types (e.g., Items, NPC),
 * this system uses the configurable streamable entity lookup from
 * `entityLookup.ts`. Any entity with a `Stream` component plus a
 * matching streamable component will be streamed automatically.
 *
 * Streamable components must include a `model: Instance` key so the
 * system can track the associated Roblox instance during streaming.
 */
function system(world: World, _crate: Crate<ClientState>): void {
	const handleStream = (
		entityId: AnyEntity,
		streamEvent: { adding: boolean; instance: Instance; removing: boolean },
		stream: Component<Components["Stream"]>,
		component: Component<{ model: Instance }>,
	): void => {
		// eslint-disable-next-line ts/strict-boolean-expressions -- Stream can be null?
		if (!stream || !streamEvent.instance.IsDescendantOf(stream.container)) {
			return;
		}

		if (streamEvent.adding) {
			streamEvent.instance.SetAttribute("clientEntityId", entityId);
			world.insert(
				entityId,
				stream.patch({ value: "in" }),
				component.patch({ model: streamEvent.instance }),
			);
		} else if (streamEvent.removing) {
			world.insert(
				entityId,
				stream.patch({ value: "out" }),
				component.patch({ model: None }),
			);
		}
	};

	/*
	 * Iterate over all entities with a Stream component.
	 * Any entity that also has a streamable component (with a model key) will be handled.
	 */
	for (const [entityId, stream] of world.query(Components.Stream)) {
		const streamableComponent = getEntityStreamableComponent(world, entityId);
		if (!streamableComponent) {
			continue;
		}

		// The entity's server-side ID is used as the stream key for useStream.
		const serverEntityId = findServerEntityIdFromMap(entityId);
		if (serverEntityId === undefined) {
			continue;
		}

		for (const [_, streamEvent] of useStream(serverEntityId)) {
			handleStream(
				entityId,
				streamEvent,
				stream,
				streamableComponent as Component<{ model: Instance }>,
			);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
