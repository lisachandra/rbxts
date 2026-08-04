import type { ClientState } from "@lisachandra/core/store";
import { getSoundFromId } from "@lisachandra/core/utils/asset";
import type { Crate } from "@rbxts/crate";
import Log from "@rbxts/log";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { SoundService, Workspace } from "@rbxts/services";

import { Components } from "../../../components";
import { useChange } from "../../../hooks";
import { connectAudio } from "../../../utils/sound";

function system(world: World): void {
	if (useChange([])) {
		const listener = new Instance("AudioListener");
		const output = new Instance("AudioDeviceOutput");
		connectAudio(listener, output);
		listener.Parent = Workspace.CurrentCamera!;
		output.Parent = Workspace.CurrentCamera!;
	}

	for (const [entityId, record] of world.queryChanged(Components.Sound)) {
		const sound = record.new;
		if (!record.old && sound) {
			if (sound.local) {
				// Non-spatial — flat playback for this player only
				const soundInstance = getSoundFromId(sound.id);
				if (soundInstance) {
					Log.Debug(`Playing local sound ${sound.id} (${soundInstance.Name})`);
					SoundService.PlayLocalSound(soundInstance);
				}

				// Fire-and-forget — despawn immediately
				world.despawn(entityId);
			} else if (sound.players) {
				// Spatial — existing emitter pipeline
				for (const player of sound.players) {
					Log.Debug(`Playing sound ${sound.id} (${getSoundFromId(sound.id)?.Name})`);
					player.Play();
				}
			}
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
