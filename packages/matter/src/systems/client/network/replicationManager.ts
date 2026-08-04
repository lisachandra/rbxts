/*
 * This system listens for replication packets from the server, deserializes the
 * data, and applies the changes to the client-side store.world. It manages spawning
 * and despawning of entities, as well as updating existing components. It uses
 * a batching mechanism for component updates to ensure efficient application of
 * changes. Debugging information can be logged when enabled via the debug UI
 * checkbox.
 */
import type { ClientState } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import { catcher } from "@lisachandra/core/utils/main";
import { typeAssertIs } from "@lisachandra/core/utils/type";
import type { Crate } from "@rbxts/crate";
import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import type {
	AnyComponent,
	AnyEntity,
	Component,
	DebugWidgets,
	SystemStruct,
	World,
} from "@rbxts/matter";
import type { OptionalKeys } from "@rbxts/matter/lib/component";
import { count, filter, includes } from "@rbxts/sift/Dictionary";

import type { ComponentKey, ExtractComponentData } from "../../../components";
import { Components } from "../../../components";
import { useMessage } from "../../../hooks";
import { Message, messaging, registry } from "../../../network";

const batchSpawns: Record<string, Array<Component<object>>> = {};
let debugging = false;
let internalDebugging = false;

function debugPrint(message: string): void {
	if (internalDebugging) {
		Log.Debug(message);
	}
}

function applyComponentUpdate(
	clientEntityId: N<AnyEntity>,
	componentToInsert: Component<object>,
	name: string,
	serverEntityId: AnyEntity,
): void {
	if (clientEntityId === undefined) {
		/*
		 * A removal can arrive before the corresponding entity has been spawned.
		 * There is no client entity on which to apply it; ignore it safely.
		 */
		if (componentToInsert === undefined) {
			return;
		}

		batchSpawns[serverEntityId] ??= [];

		let componentAlreadyExistsAtIndex = batchSpawns[serverEntityId].size();
		for (const index of $range(0, batchSpawns[serverEntityId].size() - 1)) {
			const batchedComponent = batchSpawns[serverEntityId][index]!;
			const alreadyExists =
				getmetatable(batchedComponent) === getmetatable(componentToInsert);
			componentAlreadyExistsAtIndex = alreadyExists ? index : componentAlreadyExistsAtIndex;
		}

		batchSpawns[serverEntityId][componentAlreadyExistsAtIndex] = componentToInsert;
	} else {
		store.world.insert(clientEntityId, componentToInsert);
		if (debugging) {
			Log.Info(`Replication> Modify ${clientEntityId}s${serverEntityId} adding ${name}`);
		}
	}
}

function handleDespawn(
	entityIdMap: Record<string, AnyEntity>,
	serverEntityId: AnyEntity,
): N<Readonly<ClientState["entityIdMap"]>> {
	const clientEntityId: N<AnyEntity> = entityIdMap[serverEntityId];

	if (clientEntityId !== undefined) {
		store.world.despawn(clientEntityId);

		const newEntityIdMap = { ...entityIdMap, [serverEntityId]: undefined };
		store.client.update({ entityIdMap: () => newEntityIdMap }).catch(catcher);
		delete batchSpawns[serverEntityId];

		if (debugging) {
			Log.Info(`Replication> Despawn ${clientEntityId}s${serverEntityId}`);
		}

		return newEntityIdMap;
	}

	return undefined;
}

function handleSpawn(
	entityIdMap: Record<string, AnyEntity>,
	serverEntityId: AnyEntity,
): N<Readonly<ClientState["entityIdMap"]>> {
	if (entityIdMap[serverEntityId] !== undefined) {
		return;
	}

	const componentsToInsert = batchSpawns[serverEntityId];
	if (componentsToInsert === undefined || componentsToInsert.size() === 0) {
		return;
	}

	debugPrint(
		`[client replication] spawn ${serverEntityId} (${componentsToInsert.size()} components)`,
	);
	const clientEntityId: N<AnyEntity> = store.world.spawn(...componentsToInsert);
	delete batchSpawns[serverEntityId];

	const newEntityIdMap = { ...entityIdMap, [serverEntityId]: clientEntityId };
	store.client.update({ entityIdMap: () => newEntityIdMap }).catch(catcher);

	if (debugging) {
		const insertNames = componentsToInsert.map((component) =>
			tostring(getmetatable(component)),
		);
		Log.Info(
			`Replication> Spawn ${clientEntityId}s${serverEntityId} with ${insertNames.join()}`,
		);
	}

	return newEntityIdMap;
}

function deserializeSingleComponent<T extends ComponentKey>(
	componentName: T,
	data: unknown,
	deserializer: (
		data: unknown,
		serverEntityId: AnyEntity,
		clientEntityId?: AnyEntity,
	) => OptionalKeys<Partial<ExtractComponentData<Components[T]>>>,
	serverEntityId: AnyEntity,
	clientEntityId?: AnyEntity,
): N<AnyComponent> {
	const [success, deserialized] = pcall(deserializer, data, serverEntityId, clientEntityId);
	if (!success) {
		throw new Error(
			Log.Error(
				"Error while deserializing {ComponentName}: {@Deserialized} {@Data}",
				componentName,
				deserialized,
				data,
			),
		);
	}

	const component =
		(clientEntityId !== undefined && store.world.contains(clientEntityId)
			? (store.world.get(clientEntityId, Components[componentName]) as Component<object>)
			: undefined) ?? Components[componentName]();

	return component.patch(deserialized);
}

function didComponentInsert<T extends ComponentKey>(
	componentName: T,
	data: unknown,
	deserializer: (
		data: unknown,
		serverEntityId: AnyEntity,
		clientEntityId?: AnyEntity,
	) => OptionalKeys<Partial<ExtractComponentData<Components[T]>>>,
	serverEntityId: AnyEntity,
	clientEntityId?: AnyEntity,
): clientEntityId is undefined {
	if (data === undefined) {
		/*
		 * A removal (nil payload) is only meaningful for an entity this client
		 * already spawned. For unknown entities there is nothing to remove, and
		 * deserializing nil can crash deserializers that echo their input
		 * (e.g. Team/PlayerStats/MatchState) via component.patch(nil).
		 */
		return clientEntityId === undefined;
	}

	const componentToInsert = deserializeSingleComponent(
		componentName,
		data,
		deserializer,
		serverEntityId,
		clientEntityId,
	);

	if (!componentToInsert) {
		return false;
	}

	applyComponentUpdate(clientEntityId, componentToInsert, componentName, serverEntityId);

	return true;
}

function deserializeIncomingPackets(entityIdMap: Readonly<ClientState["entityIdMap"]>): void {
	for (const [_, { componentId, payload, serverEntityId }] of useMessage(
		messaging.client,
		Message.Component,
	)) {
		typeAssertIs<AnyEntity>(serverEntityId);

		const codec = registry.getById(componentId);
		if (!codec) {
			continue;
		}

		const componentName = codec.componentKey as ComponentKey;
		debugPrint(`[client replication] packet ${componentName}#${componentId} ${serverEntityId}`);
		const clientEntityId: N<AnyEntity> = entityIdMap[serverEntityId];
		const data = payload ? codec.payloadSerializer.deserialize(payload) : undefined;
		if ((data as unknown) !== undefined && !codec.payloadGuard(data)) {
			Log.Warn(
				`Skipping replication for ${componentName}; payload failed runtime validation`,
			);
			continue;
		}

		if (
			!didComponentInsert(
				componentName,
				data,
				codec.deserializer as never,
				serverEntityId,
				clientEntityId,
			)
		) {
			store.world.remove(clientEntityId, Components[componentName]);
			if (debugging) {
				Log.Info(
					`Replication> Modify ${clientEntityId}s${serverEntityId} removing ${componentName}`,
				);
			}
		}
	}
}

function handleItemGUIDMap(crate: Crate<ClientState>): void {
	for (const [_, itemGUIDMap] of useMessage(messaging.client, Message.ItemGUIDMap)) {
		Log.Verbose("Processing ItemGUIDMap packet {info}", {
			packetSize: count(itemGUIDMap),
		});

		const currentItemGUIDMap = filter(
			crate.getState("itemGUIDMap"),
			(id) => !includes(itemGUIDMap, id),
		);
		const newItemGUIDMap = { ...currentItemGUIDMap, ...itemGUIDMap } as Record<string, number>;

		crate.update({ itemGUIDMap: () => newItemGUIDMap }).catch(catcher);
	}
}

/* Handles replication of entities and components from server to client. */
function system(_world: World, crate: Crate<ClientState>, ui: DebugWidgets): void {
	for (const [_, { startClock, startEpoch }] of useMessage(messaging.client, Message.Time)) {
		crate
			.update({
				serverStartClock: startClock,
				serverStartEpoch: startEpoch,
			})
			.catch(catcher);
	}

	debugging = ui.checkbox("Log replication").checked();
	internalDebugging = ui.checkbox("Trace client replication internals").checked();
	let entityIdMap = store.client.getState("entityIdMap");

	handleItemGUIDMap(crate);
	deserializeIncomingPackets(entityIdMap);

	for (const [_, serverEntityId] of useMessage(messaging.client, Message.DespawnEntity)) {
		debugPrint(`[client replication] despawn message ${serverEntityId}`);
		entityIdMap = handleDespawn(entityIdMap, serverEntityId as AnyEntity) ?? entityIdMap;
	}

	for (const [_, serverEntityId] of useMessage(messaging.client, Message.SpawnEntity)) {
		debugPrint(`[client replication] spawn message ${serverEntityId}`);
		entityIdMap = handleSpawn(entityIdMap, serverEntityId as AnyEntity) ?? entityIdMap;
	}
}

export const meta = {
	phase: "preRender",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
