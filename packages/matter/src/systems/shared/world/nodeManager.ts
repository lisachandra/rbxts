/*
 * This system initializes and manages navigation nodes in the game world. It
 * assigns attributes to nodes and registers them for use in navigation and
 * pathfinding. It ensures nodes are properly configured for NPC and player
 * interactions.
 */
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { Components } from "../../../components";
import { ClientState, ServerState } from "@lisachandra/core/out/store";

function system(world: World): void {
	for (const [, record] of world.queryChanged(Components.Node)) {
		if (record.new || !record.old) {
			continue;
		}

		const node = record.old;
		node.model.Destroy();
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState | ServerState>, ui: DebugWidgets]>;
