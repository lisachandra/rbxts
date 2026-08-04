import type { ServerState } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import { applyPlotVisual } from "server/game/helpers";
import { GARDEN_DECAY_TIME, GARDEN_GROWTH_TIME } from "shared/game/constants";

function system(world: World): void {
	const now = os.clock();

	for (const [entityId, plot] of world.query(Components.GardenPlot)) {
		if (plot.stage !== "Watered") {
			continue;
		}

		if (now - plot.lastTouchedAt < GARDEN_GROWTH_TIME) {
			continue;
		}

		applyPlotVisual(plot.part, "Grown");
		world.insert(
			entityId,
			Components.GardenPlot({ ...plot, lastTouchedAt: now, progress: 2, stage: "Grown" }),
		);
		world.insert(entityId, Components.DecayState({ nextDecayAt: now + GARDEN_DECAY_TIME }));
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
