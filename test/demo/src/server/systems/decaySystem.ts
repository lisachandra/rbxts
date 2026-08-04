import type { ServerState } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import { applyPlotVisual } from "server/game/helpers";
import { GARDEN_DECAY_TIME } from "shared/game/constants";
import { regressPlotStage } from "shared/game/helpers";

function system(world: World): void {
	const now = os.clock();

	for (const [entityId, plot, decay] of world.query(
		Components.GardenPlot,
		Components.DecayState,
	)) {
		if (plot.stage === "Dirty" || plot.stage === "Grown" || decay.nextDecayAt > now) {
			continue;
		}

		const regressed = regressPlotStage(plot.stage);
		if (regressed === plot.stage) {
			continue;
		}

		applyPlotVisual(plot.part, regressed);
		world.insert(
			entityId,
			Components.GardenPlot({ ...plot, lastTouchedAt: now, stage: regressed }),
		);
		world.insert(entityId, Components.DecayState({ nextDecayAt: now + GARDEN_DECAY_TIME }));
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
