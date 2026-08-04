import type { ClientState, ServerState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import { type DebugWidgets, type SystemStruct, useHookState, type World } from "@rbxts/matter";

import { Components } from "../../../components";
import { useThrottle } from "../../../hooks";

const soundGcInterval = 1;

function system(world: World): void {
	if (!useThrottle(soundGcInterval)) {
		return;
	}

	for (const [entityId, sound] of world.query(Components.Sound)) {
		if (!sound?.emitter || !sound.players || sound.local) {
			continue;
		}

		const state = useHookState<{ ended: Map<AudioPlayer, number> }>(entityId, () =>
			world.contains(entityId),
		);
		state.ended ??= new Map();

		for (const player of sound.players) {
			if (!player.IsPlaying && useThrottle(10, player)) {
				state.ended.set(player, 0);
			} else if (player.IsPlaying) {
				state.ended.delete(player);
			}
		}

		if (
			sound.players.every(
				(player) => os.clock() - (state.ended.get(player) ?? os.clock()) > 10,
			)
		) {
			world.despawn(entityId);
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState | ServerState>, ui: DebugWidgets]>;
