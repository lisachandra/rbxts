import { Constant } from "@lisachandra/constant";
import type { ClientState, ServerState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import { type DebugWidgets, type SystemStruct, useHookState, type World } from "@rbxts/matter";

import { Components } from "../../../components";
import {
	configureSoundDebugGc,
	markSoundDebugGc,
	recordDespawned,
} from "../../../debug/soundDebugStats";
import { useThrottle } from "../../../hooks";

const c = new Constant().add("SOUND_GC_INTERVAL", 1).add("SOUND_GC", 10).build();

function system(world: World): void {
	configureSoundDebugGc(c.SOUND_GC_INTERVAL, c.SOUND_GC);
	if (!useThrottle(c.SOUND_GC_INTERVAL)) {
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
			if (!player.IsPlaying && useThrottle(c.SOUND_GC, player)) {
				state.ended.set(player, 0);
			} else if (player.IsPlaying) {
				state.ended.delete(player);
			}
		}

		if (
			sound.players.every(
				(player) => os.clock() - (state.ended.get(player) ?? os.clock()) > c.SOUND_GC,
			)
		) {
			world.despawn(entityId);
			recordDespawned();
		}
	}

	markSoundDebugGc(os.clock());
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState | ServerState>, ui: DebugWidgets]>;
