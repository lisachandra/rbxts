import type { ServerState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { SystemStruct, World } from "@rbxts/matter";
import type { Widgets as DebugWidgets } from "@rbxts/plasma";

import { Components } from "../../../components";
import { useChange } from "../../../hooks";
import { connectAudio } from "../../../utils/sound";

function system(world: World, _crate: Crate<ServerState>): void {
	for (const [entityId, profile] of world.query(Components.Profile)) {
		if (!useChange([], entityId)) {
			continue;
		}

		let microphone = profile.player.FindFirstChildWhichIsA("AudioDeviceInput");
		if (!microphone) {
			microphone = new Instance("AudioDeviceInput");
			microphone.Muted = false;
			microphone.Player = profile.player;
			microphone.Parent = profile.player;
		}

		profile.player.CharacterAdded.Connect((character) => {
			const emitter = new Instance("AudioEmitter");
			connectAudio(microphone, emitter);
			emitter.Parent = character;
		});
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
