import type { ServerState } from "@lisachandra/core/store";
import { iterate } from "@lisachandra/core/utils/type";
/*
 * This system manages the replication of components from server to client. It
 * iterates through all players and relevant components, serializes the
 * component data, and sends it to the corresponding client. It handles both
 * initial replication and subsequent changes to components. It also handles
 * debug settings for sound.
 */
import type { Crate } from "@rbxts/crate";
import Log from "@rbxts/log";
import type { AnyComponent, AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { isEmpty } from "@rbxts/object-utils";
import type { SerializedData } from "@rbxts/serio";
import { removeValue } from "@rbxts/sift/Array";

import type { ChangeRecord, ComponentKey } from "../../../components";
import { Components } from "../../../components";
import { Message, messaging, registry } from "../../../network";
import { meta as hotbarManager } from "../item/hotbarManager";
import { meta as itemManager } from "../item/itemManager";

const hasReceived: Array<Player> = [];
const replicatedEntities = new Map<Player, Set<AnyEntity>>();

let internalDebugging = false;

function debugPrint(message: string): void {
	if (internalDebugging) {
		print(message);
	}
}

type Payload = Record<
	string,
	Record<string, { payload?: buffer | { blobs?: Array<defined>; buf?: buffer } }>
>;

function componentIsWithinScope(
	world: World,
	playerEntityId: AnyEntity,
	componentEntityId: AnyEntity,
	componentName: ComponentKey,
): boolean {
	const scope = world.get(componentEntityId, Components.ReplicationScope);
	if (!scope) {
		return true;
	}

	const entry = scope.find((value) => value.components.includes(componentName));
	if (!entry) {
		return true;
	}

	const idsIncludeEntity = entry.ids.includes(playerEntityId);
	return entry.mode === "include" ? idsIncludeEntity : !idsIncludeEntity;
}

function serializeSingleComponent(
	viewerEntityId: AnyEntity,
	targetEntityId: AnyEntity,
	record: ChangeRecord<AnyComponent>,
	componentKey: string,
	hasReceivedPayload: boolean,
	mode: "all" | "owner",
): false | undefined | SerializedData {
	const codec = registry.get(componentKey);
	if (!codec) {
		Log.Warn(`Skipping replication for unregistered component ${componentKey}`);
		return;
	}

	const [success, serialized] = pcall(() => {
		const result = codec.serializer(
			record,
			viewerEntityId,
			targetEntityId,
			mode === "owner",
			hasReceivedPayload,
		) as unknown;

		if (result === undefined || result === false) {
			return result;
		}

		if (!codec.payloadGuard(result)) {
			throw `Generated invalid replication payload for ${componentKey}`;
		}

		return codec.payloadSerializer.serialize(result);
	});

	if (!success) {
		Log.Error(
			`Error while serializing ${componentKey} for ${viewerEntityId}: ${serialized}`,
			record,
		);
		return;
	}

	return serialized;
}

function setComponentPayload(
	player: Player,
	viewerEntityId: AnyEntity,
	targetEntityId: AnyEntity,
	payloads: Map<Player, Payload>,
	record: ChangeRecord<AnyComponent>,
	componentKey: string,
	mode: "all" | "owner",
	key: string,
): void {
	const hasReceivedPayload = hasReceived.includes(player);
	const payload = payloads.get(player) ?? {};

	const serializedPayload = serializeSingleComponent(
		viewerEntityId,
		targetEntityId,
		record,
		componentKey,
		hasReceivedPayload,
		mode,
	);

	if (serializedPayload !== false) {
		payload[key] ??= {};
		payload[key][componentKey] = {
			payload: serializedPayload,
		};

		payloads.set(player, payload);
	}
}

function replicateComponentForPlayer(
	world: World,
	player: Player,
	viewerEntityId: AnyEntity,
	targetEntityId: AnyEntity,
	payloads: Map<Player, Payload>,
	componentKey: string,
): void {
	const codec = registry.get(componentKey);
	if (!codec) {
		return;
	}

	const component = world.get(targetEntityId, codec.component);
	if (
		!component ||
		(codec.mode === "owner" && targetEntityId !== viewerEntityId) ||
		!componentIsWithinScope(
			world,
			viewerEntityId,
			targetEntityId,
			codec.componentKey as ComponentKey,
		)
	) {
		return;
	}

	setComponentPayload(
		player,
		viewerEntityId,
		targetEntityId,
		payloads,
		{ new: component },
		codec.componentKey,
		codec.mode,
		`${targetEntityId}`,
	);
}

function getEligibleEntities(world: World, viewerEntityId: AnyEntity): Set<AnyEntity> {
	const eligible = new Set<AnyEntity>();
	for (const [targetEntityId] of world) {
		for (const [componentKey, codec] of registry.entries()) {
			if (
				world.get(targetEntityId, codec.component) !== undefined &&
				(codec.mode !== "owner" || targetEntityId === viewerEntityId) &&
				componentIsWithinScope(
					world,
					viewerEntityId,
					targetEntityId,
					componentKey as ComponentKey,
				)
			) {
				eligible.add(targetEntityId);
				break;
			}
		}
	}

	return eligible;
}

function handleInitialReplication(
	world: World,
	crate: Crate<ServerState>,
	payloads: Map<Player, Payload>,
	initialized: Array<Player>,
): void {
	for (const [componentEntityId, profile] of world.query(Components.Profile)) {
		debugPrint(
			`[server replication] profile seen ${profile.player.Name} entity=${componentEntityId} received=${tostring(hasReceived.includes(profile.player))}`,
		);
		const playerHasReceived = hasReceived.includes(profile.player);
		const previous = replicatedEntities.get(profile.player) ?? new Set<AnyEntity>();
		const eligible = getEligibleEntities(world, componentEntityId);
		replicatedEntities.set(profile.player, eligible);
		for (const entityId of previous) {
			if (!eligible.has(entityId)) {
				messaging.client.emit(profile.player, Message.DespawnEntity, entityId);
			}
		}

		if (playerHasReceived) {
			debugPrint(`[server replication] skip initial ${profile.player.Name}`);
			continue;
		}

		messaging.client.emit(profile.player, Message.ItemGUIDMap, crate.getState("itemGUIDMap"));
		debugPrint(`[server replication] initial ${profile.player.Name}`);
		initialized.push(profile.player);

		if (!playerHasReceived) {
			hasReceived.push(profile.player);
			replicatedEntities.set(profile.player, eligible);
			profile.janitor.Add(() => {
				removeValue(hasReceived, profile.player);
				replicatedEntities.delete(profile.player);
			});
		}

		for (const [componentKey] of registry.entries()) {
			debugPrint(`[server replication] iter codec ${profile.player.Name} ${componentKey}`);
			for (const [targetEntityId] of world) {
				replicateComponentForPlayer(
					world,
					profile.player,
					componentEntityId,
					targetEntityId,
					payloads,
					componentKey,
				);
			}
		}
	}
}

/* Replicate changes to components for all players, except for local components which are only replicated to the owning player. */
function handleComponentChanges(
	world: World,
	payloads: Map<Player, Payload>,
	initialized: Array<Player>,
): void {
	for (const [componentKey, codec] of registry.entries()) {
		const componentName = codec.componentKey as ComponentKey;

		for (const [targetEntityId, record] of world.queryChanged(codec.component)) {
			for (const [viewerEntityId, profile] of world.query(Components.Profile)) {
				if (
					initialized.includes(profile.player) ||
					(codec.mode === "owner" && targetEntityId !== viewerEntityId) ||
					!componentIsWithinScope(world, viewerEntityId, targetEntityId, componentName)
				) {
					continue;
				}

				/*
				 * Never send component removals for entities this client was not
				 * previously told about: the client cannot apply them, and a nil
				 * payload for an unknown entity crashes its deserializer.
				 */
				if (
					record.new === undefined &&
					!(replicatedEntities.get(profile.player)?.has(targetEntityId) ?? false)
				) {
					continue;
				}

				debugPrint(
					`[server replication] change ${profile.player.Name} ${componentKey} ${targetEntityId}`,
				);
				setComponentPayload(
					profile.player,
					viewerEntityId,
					targetEntityId,
					payloads,
					record,
					componentKey,
					codec.mode,
					`${targetEntityId}`,
				);
			}
		}
	}
}

/*
 * Send payloads to clients. This includes initial replication data and
 * subsequent component changes. Handles spawning and despawning of
 * entities.
 */
function sendPayloads(payloads: Map<Player, Payload>, initialized: Array<Player>): void {
	if (isEmpty(payloads)) {
		return;
	}

	for (const [player, payloadContainer] of payloads) {
		if (initialized.includes(player)) {
			print(`sending initial payload to: ${player}`, payloadContainer);
		}

		for (const [strEntityId, componentMap] of iterate(payloadContainer)) {
			const entityId = tonumber(strEntityId)! as AnyEntity;
			let sentComponent = false;

			if (isEmpty(componentMap)) {
				messaging.client.emit(player, Message.DespawnEntity, entityId);
				continue;
			}

			for (const [componentKey, payload] of iterate(payloadContainer[`${entityId}`]!)) {
				const codec = registry.get(componentKey);
				if (!codec) {
					continue;
				}

				debugPrint(
					`[server replication] send component ${player.Name} ${componentKey}#${codec.id} ${entityId}`,
				);
				sentComponent = payload?.payload !== undefined;

				messaging.client.emit(player, Message.Component, {
					componentId: codec.id,
					payload: typeIs(payload?.payload, "buffer")
						? {
								buf: payload.payload,
							}
						: payload?.payload,
					serverEntityId: entityId,
				});
			}

			if (sentComponent) {
				messaging.client.emit(player, Message.SpawnEntity, entityId);
				replicatedEntities.get(player)?.add(entityId);
				debugPrint(`[server replication] send spawn ${player.Name} ${entityId}`);
			}
		}
	}
}

function system(world: World, crate: Crate<ServerState>, ui: DebugWidgets): void {
	internalDebugging = ui.checkbox("Trace server replication internals").checked();

	const payloads = new Map<Player, Payload>();
	const initialized: Array<Player> = [];

	handleInitialReplication(world, crate, payloads, initialized);
	handleComponentChanges(world, payloads, initialized);
	sendPayloads(payloads, initialized);
}

export const meta = {
	after: [hotbarManager, itemManager],
	phase: "preAnimation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
