import type { ClientState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import Iris from "@rbxts/iris";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import { Components } from "../../../components";
import { readSoundDebugCounters, readSoundDebugGc } from "../../../debug/soundDebugStats";

const WINDOW_SIZE = new Vector2(460, 420);

let viewAudioDebugger = false;

/**
 * Formats a count as a zero-padded three-digit string, or a dash when unavailable.
 *
 * @param value - The numeric count to format.
 * @returns A table-safe string representation.
 */
function formatCount(value: number): string {
	return tostring(value);
}

function renderCounters(): void {
	const counters = readSoundDebugCounters();
	Iris.SeparatorText(["Lifecycle"]);
	Iris.Text([`Plays: ${formatCount(counters.plays)}`]);
	Iris.Text([`Local: ${formatCount(counters.localPlays)}`]);
	Iris.Text([`Spatial: ${formatCount(counters.spatialPlays)}`]);

	Iris.SeparatorText(["Cache"]);
	Iris.Text([`Node returns: ${formatCount(counters.nodeReturns)}`]);
	Iris.Text([`Node destroys: ${formatCount(counters.nodeDestroys)}`]);
	Iris.Text([`Despawns: ${formatCount(counters.despawns)}`]);
}

function renderGc(): void {
	const gc = readSoundDebugGc();
	Iris.SeparatorText(["Garbage Collection"]);
	Iris.Text([`Sweep interval: ${formatCount(gc.interval)}s`]);
	Iris.Text([`Idle threshold: ${formatCount(gc.idleSeconds)}s`]);
	Iris.Text([`Last sweep: ${gc.lastSweepAt === 0 ? "never" : tostring(gc.lastSweepAt)}`]);
}

function renderActive(world: World): void {
	Iris.SeparatorText(["Active Sounds"]);
	let count = 0;
	for (const [_entityId, sound] of world.query(Components.Sound)) {
		if (sound === undefined) {
			continue;
		}

		count += 1;
		const playing = sound.players?.filter((player) => player.IsPlaying).size() ?? 0;
		const players = sound.players?.size() ?? 0;
		const kind = sound.local ? "local" : "spatial";
		Iris.Text([`[${kind}] #${sound.id} — ${players} player(s), ${playing} playing`]);
	}

	if (count === 0) {
		Iris.Text(["No active sounds"]);
	}
}

function renderAudioDebugger(world: World): void {
	Iris.Window(["Audio Debugger", undefined, undefined, undefined, true], {
		size: Iris.State(WINDOW_SIZE),
	});
	{
		renderCounters();
		renderGc();
		renderActive(world);
	}

	Iris.End();
}

function system(world: World, _crate: Crate<ClientState>, ui: DebugWidgets): void {
	if (ui.checkbox("View Audio Debugger", { checked: viewAudioDebugger }).clicked()) {
		viewAudioDebugger = !viewAudioDebugger;
	}

	if (viewAudioDebugger) {
		renderAudioDebugger(world);
	}
}

export const meta = {
	phase: "renderLast",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
