/* oxlint-disable eslint/max-classes-per-file -- command classes are registered decorators */
import { store } from "@lisachandra/core";
import { Components } from "@lisachandra/matter";
import { adminOrDeveloper } from "@lisachandra/platform";
import type { CommandContext } from "@rbxts/centurion";
import { Command, Guard, Register } from "@rbxts/centurion";

import { applyPlotVisual, pushNotification, setCarryState } from "server/game/helpers";
import { GARDEN_DECAY_TIME } from "shared/game/constants";

@Register()
export class GardenResetCommand {
	@Command({ description: "Reset all garden plots.", name: "gardenreset" })
	@Guard(adminOrDeveloper)
	public gardenreset(_context: CommandContext): void {
		for (const [entityId, plot] of store.world.query(Components.GardenPlot)) {
			applyPlotVisual(plot.part, "Dirty");
			store.world.insert(
				entityId,
				Components.GardenPlot({
					...plot,
					lastTouchedAt: os.clock(),
					progress: 0,
					stage: "Dirty",
				}),
			);
			store.world.insert(
				entityId,
				Components.DecayState({ nextDecayAt: os.clock() + GARDEN_DECAY_TIME }),
			);
		}
	}
}

@Register()
export class GardenGrowCommand {
	@Command({ description: "Force all watered plots to grow.", name: "gardengrow" })
	@Guard(adminOrDeveloper)
	public gardengrow(_context: CommandContext): void {
		for (const [entityId, plot] of store.world.query(Components.GardenPlot)) {
			if (plot.stage !== "Watered") {
				continue;
			}

			applyPlotVisual(plot.part, "Grown");
			store.world.insert(
				entityId,
				Components.GardenPlot({
					...plot,
					lastTouchedAt: os.clock(),
					progress: 2,
					stage: "Grown",
				}),
			);
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
		// oxlint-disable-next-line eslint/no-unreachable-loop -- at most one progress entity exists
		for (const [, progress] of store.world.query(Components.GardenProgress)) {
			print(
				`Garden health=${tostring(progress.health)} restored=${tostring(progress.restoredPlots)}/${tostring(progress.totalPlots)} harvested=${tostring(progress.harvested)}`,
			);
			return;
		}
	}
}
