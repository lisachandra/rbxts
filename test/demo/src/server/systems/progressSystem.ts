import { math as tsMath } from "@lisachandra/core";
import type { ServerState } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import { computeGardenHealth, isRestoredPlot } from "shared/game/helpers";

function system(world: World): void {
	let totalPlots = 0;
	let restoredPlots = 0;

	for (const [, plot] of world.query(Components.GardenPlot)) {
		totalPlots += 1;
		if (isRestoredPlot(plot.stage)) {
			restoredPlots += 1;
		}
	}

	for (const [entityId, progress] of world.query(Components.GardenProgress)) {
		const health = tsMath.round(computeGardenHealth(restoredPlots, totalPlots) * 100, 0);
		world.insert(
			entityId,
			Components.GardenProgress({
				...progress,
				health,
				restoredPlots,
				totalPlots,
			}),
		);
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
