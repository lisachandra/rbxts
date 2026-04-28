import type { Crate } from "@rbxts/crate";
import Log from "@rbxts/log";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { Workspace } from "@rbxts/services";
import { useChange } from "../../../hooks";
import { connectAudio } from "../../../utils/sound";
import { getComponent } from "../../../components";
import { ClientState } from "@lisachandra/core/out/store";
import { getSoundFromId } from "@lisachandra/core/out/utils/asset";

function system(world: World): void {
	if (useChange([])) {
		const listener = new Instance("AudioListener");
		const output = new Instance("AudioDeviceOutput");
		connectAudio(listener, output);
		listener.Parent = Workspace.CurrentCamera!;
		output.Parent = Workspace.CurrentCamera!;
	}

	for (const [, record] of world.queryChanged(getComponent("Sound"))) {
		const sound = record.new;
		if (!record.old && sound && sound.players) {
			for (const player of sound.players) {
				Log.Debug(`Playing sound ${sound.id} (${getSoundFromId(sound.id)?.Name})`);
				player.Play();
			}
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
