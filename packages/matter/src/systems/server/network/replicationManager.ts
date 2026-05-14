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
import { removeValue } from "@rbxts/sift/out/Array";

import type { ServerState } from "@lisachandra/core/out/store";
import { iterate } from "@lisachandra/core/out/utils/type";
import { ChangeRecord, ComponentKey, getComponent } from "../../../components";
import { useMessage } from "../../../hooks/useMessage";
import { meta as hotbarManager } from "../item/hotbarManager";
import { meta as itemManager } from "../item/itemManager";
import { Message, messaging, registry } from "../../../network";

const hasReceived: Array<Player> = [];

type Payload = Record<
	string,
	{
		[componentKey: string]: { payload?: buffer | { blobs?: Array<defined>; buf?: buffer } };
	}
>;

function componentIsWithinScope(
	world: World,
	playerEntityId: AnyEntity,
	componentEntityId: AnyEntity,
	componentName: ComponentKey,
): boolean {
	const scope = world.get(componentEntityId, getComponent("ReplicationScope"));
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
): { blobs?: Array<defined>; buf?: buffer } | undefined {
	const codec = registry.get(componentKey);
	if (!codec) {
		Log.Warn(`Skipping replication for unregistered component ${componentKey}`);
		return;
	}

	const [success, serialized] = pcall(() => {
		const serialized = codec.serializer(
			record,
			viewerEntityId,
			targetEntityId,
			mode === "owner",
			hasReceivedPayload
		)

		if ((serialized as unknown) === undefined) {
			return;
		}

		return codec.payloadSerializer.serialize(serialized);
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
	const payload = payloads.get(player) ?? ({} as Payload);

	payload[key] ??= {};
	payload[key][componentKey] =
		"new" in record
			? {
					payload: serializeSingleComponent(
						viewerEntityId,
						targetEntityId,
						record,
						componentKey,
						hasReceivedPayload,
						mode,
					),
				}
			: {};

	payloads.set(player, payload);
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

/* Initial replication for newly connected players. Sends ItemGUIDMap and replicates all relevant components. */
function handleInitialReplication(
	world: World,
	crate: Crate<ServerState>,
	payloads: Map<Player, Payload>,
	initialized: Array<Player>,
	loaded: Array<Player>,
): void {
	for (const [componentEntityId, profile] of world.query(getComponent("Profile"))) {
		const playerHasReceived = hasReceived.includes(profile.player);

		if (playerHasReceived && !loaded.includes(profile.player)) {
			continue;
		}

		messaging.client.emit(profile.player, Message.ItemGUIDMap, crate.getState("itemGUIDMap"));
		initialized.push(profile.player);

		if (!playerHasReceived) {
			hasReceived.push(profile.player);
			profile.janitor.Add(() => removeValue(hasReceived, profile.player));
		}

		for (const [componentKey] of registry.entries()) {
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
			for (const [viewerEntityId, profile] of world.query(getComponent("Profile"))) {
				if (
					initialized.includes(profile.player) ||
					(codec.mode === "owner" && targetEntityId !== viewerEntityId) ||
					!componentIsWithinScope(world, viewerEntityId, targetEntityId, componentName)
				) {
					continue;
				}

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
			Log.Info("sending initial payload to:", player, payloadContainer);
		}

		for (const [strEntityId, componentMap] of iterate(payloadContainer)) {
			const entityId = tonumber(strEntityId)! as AnyEntity;

			if (isEmpty(componentMap)) {
				messaging.client.emit(player, Message.DespawnEntity, entityId);
				continue;
			}

			for (const [componentKey, payload] of iterate(payloadContainer[`${entityId}`]!)) {
				const codec = registry.get(componentKey as string);
				if (!codec) {
					continue;
				}

				messaging.client.emit(player, Message.Component, {
					componentKey: componentKey as string,
					payload: typeIs(payload?.payload, "buffer") ? {
						buf: payload.payload
					} : payload?.payload,
					serverEntityId: entityId,
				});
			}

			messaging.client.emit(player, Message.SpawnEntity, entityId);
		}
	}
}

function system(world: World, crate: Crate<ServerState>): void {
	const payloads = new Map<Player, Payload>();
	const initialized: Array<Player> = [];
	const loaded: Array<Player> = [];

	// Track players who have loaded.
	// On server, we listen via messaging.server to receive from clients.
	// Tether server callback receives (player, data) -> yields [index, player, data].
	for (const [_, player] of useMessage(messaging.server, Message.Loaded)) {
		if (!hasReceived.includes(player!)) {
			continue;
		}

		loaded.push(player!);
	}

	handleInitialReplication(world, crate, payloads, initialized, loaded);
	handleComponentChanges(world, payloads, initialized);
	sendPayloads(payloads, initialized);
}

export const meta = {
	after: [hotbarManager, itemManager],
	phase: "preAnimation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
