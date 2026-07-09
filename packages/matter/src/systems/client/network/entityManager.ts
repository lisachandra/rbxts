/*
 * This system handles the creation, management, and destruction of entities
 * within the game world. It tracks changes to entity components, such as player
 * profiles, NPCs, and other objects. It ensures that components are properly
 * inserted or removed as entities are added or removed from the world. It also
 * manages specific components like camera systems and pathfinding for NPCs.
 */
import type { Crate } from "@rbxts/crate";
import { Janitor } from "@rbxts/janitor";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { AnyComponent, Component } from "@rbxts/matter/lib/component";
import { Players, Workspace } from "@rbxts/services";

import { meta as replicationManager } from "./replicationManager";
import { ChangeRecord, Components, ComponentKey, isComponent } from "../../../components";
import { is } from "@lisachandra/core/out/utils/type";
import { ClientState } from "@lisachandra/core";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";

function handleComponentRemoval(record: ChangeRecord<AnyComponent>): void {
	if (record.old && !record.new && "janitor" in record.old && is<Janitor>(record.old.janitor)) {
		record.old.janitor.Destroy();
	}
}

function handleComponentInsertion(
	world: World,
	entityId: AnyEntity,
	component: Component<object>,
	hasJanitor: boolean,
	crate: Crate<ClientState>,
): void {
	const componentsToInsert: Array<Component<object>> = [];
	let janitor: N<Janitor>;
	if (hasJanitor) {
		janitor = new Janitor();
		componentsToInsert.push(component.patch({ janitor }));
	}

	if (isComponent(component, "Profile")) {
		component.player.SetAttribute("clientEntityId", entityId);
	} else if ("model" in component && typeIs(component.model, "Instance")) {
		component.model.SetAttribute("clientEntityId", entityId);
	}

	if (componentsToInsert.size() > 0) {
		world.insert(entityId, ...componentsToInsert);
		world.commitCommands();
	}
}

function handleComponentChange(
	world: World,
	crate: Crate<ClientState>,
	componentName: ComponentKey,
	hasJanitor = false,
): void {
	for (const [entityId, record] of world.queryChanged(Components[componentName])) {
		if (record.old || !record.new) {
			handleComponentRemoval(record);
			continue;
		}

		const component = record.new;
		handleComponentInsertion(world, entityId, component, hasJanitor, crate);
	}
}

/*
 * Manages entity lifecycle (creation and destruction) and assigns appropriate
 * components.
 */
function system(world: World, crate: Crate<ClientState>): void {
	// Tracks changes in components (e.g., NPCs or profiles) and applies updates.
	handleComponentChange(world, crate, "Profile", true);
	handleComponentChange(world, crate, "Items");
	handleComponentChange(world, crate, "Node");

	// Track changes in characters to update them with entity ids.
	for (const character of Workspace.Characters.GetChildren()) {
		const serverEntityId = character.GetAttribute<AnyEntity>("serverEntityId");
		const clientEntityId = character.GetAttribute<AnyEntity>("clientEntityId");
		if (serverEntityId === undefined || clientEntityId !== undefined) {
			continue;
		}

		const player = getInstanceWithAttribute(
			Players.GetPlayers(),
			"serverEntityId",
			serverEntityId,
		);
		if (player) {
			character.SetAttribute("clientEntityId", player.GetAttribute("clientEntityId"));
		}
	}
}

export const meta = {
	after: [replicationManager],
	phase: "preRender",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
