import { store } from "@lisachandra/core";
import { getComponent } from "@lisachandra/matter";
import { adminOrDeveloper } from "@lisachandra/platform";
import type { CommandContext } from "@rbxts/centurion";
import { Command, Guard, Register } from "@rbxts/centurion";
import { GARDEN_DECAY_TIME } from "shared/game/constants";
import { applyPlotVisual, pushNotification, setCarryState } from "server/game/helpers";

@Register()
export class GardenResetCommand {
	@Command({ description: "Reset all garden plots.", name: "gardenreset" })
	@Guard(adminOrDeveloper)
	public gardenreset(_context: CommandContext): void {
		for (const [entityId, plot] of store.world.query(getComponent("GardenPlot"))) {
			applyPlotVisual(plot.part, "Dirty");
			store.world.insert(entityId, getComponent("GardenPlot")({ ...plot, stage: "Dirty", progress: 0, lastTouchedAt: os.clock() }));
			store.world.insert(entityId, getComponent("DecayState")({ nextDecayAt: os.clock() + GARDEN_DECAY_TIME }));
		}
	}
}

@Register()
export class GardenGrowCommand {
	@Command({ description: "Force all watered plots to grow.", name: "gardengrow" })
	@Guard(adminOrDeveloper)
	public gardengrow(_context: CommandContext): void {
		for (const [entityId, plot] of store.world.query(getComponent("GardenPlot"))) {
			if (plot.stage !== "Watered") {
				continue;
			}

			applyPlotVisual(plot.part, "Grown");
			store.world.insert(entityId, getComponent("GardenPlot")({ ...plot, stage: "Grown", progress: 2, lastTouchedAt: os.clock() }));
		}
	}
}

@Register()
export class GardenFillWaterCommand {
	@Command({ description: "Give yourself water.", name: "gardenfillwater" })
	@Guard(adminOrDeveloper)
	public gardenfillwater(context: CommandContext): void {
		const entityId = context.executor.GetAttribute("serverEntityId");
		if (entityId === undefined) {
			return;
		}

		setCarryState(store.world, entityId as never, "Water", 1);
		pushNotification(store.world, entityId as never, "Admin granted water");
	}
}

@Register()
export class GardenProgressCommand {
	@Command({ description: "Print current garden progress.", name: "gardenprogress" })
	@Guard(adminOrDeveloper)
	public gardenprogress(_context: CommandContext): void {
		for (const [, progress] of store.world.query(getComponent("GardenProgress"))) {
			print(
				`Garden health=${tostring(progress.health)} restored=${tostring(progress.restoredPlots)}/${tostring(progress.totalPlots)} harvested=${tostring(progress.harvested)}`,
			);
			return;
		}
	}
}
