import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ServerState } from "@lisachandra/core/out/store";
import { getComponent } from "@lisachandra/matter";
import { GARDEN_DECAY_TIME } from "shared/game/constants";
import { regressPlotStage } from "shared/game/helpers";
import { applyPlotVisual } from "server/game/helpers";

function system(world: World): void {
	const now = os.clock();

	for (const [entityId, plot, decay] of world.query(getComponent("GardenPlot"), getComponent("DecayState"))) {
		if (plot.stage === "Dirty" || plot.stage === "Grown" || decay.nextDecayAt > now) {
			continue;
		}

		const regressed = regressPlotStage(plot.stage);
		if (regressed === plot.stage) {
			continue;
		}

		applyPlotVisual(plot.part, regressed);
		world.insert(entityId, getComponent("GardenPlot")({ ...plot, stage: regressed, lastTouchedAt: now }));
		world.insert(entityId, getComponent("DecayState")({ nextDecayAt: now + GARDEN_DECAY_TIME }));
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
