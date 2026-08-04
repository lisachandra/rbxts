import type { ServerState } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

import {
	applyPickupVisual,
	applyPlotVisual,
	applyWaterVisual,
	createGardenPart,
	ensureGardenFolder,
} from "server/game/helpers";
import { createGardenSeed } from "server/game/seed";
import { GARDEN_DECAY_TIME } from "shared/game/constants";

let bootstrapped = false;

function system(world: World): void {
	if (bootstrapped) {
		return;
	}

	bootstrapped = true;

	const folder = ensureGardenFolder();
	folder.ClearAllChildren();
	const seed = createGardenSeed();

	world.spawn(
		Components.GardenProgress({
			harvested: 0,
			health: 0,
			restoredPlots: 0,
			totalPlots: seed.plots.size(),
		}),
	);

	for (const plot of seed.plots) {
		const part = createGardenPart(
			folder,
			plot.id,
			plot.position,
			new Vector3(10, 1, 10),
			Color3.fromRGB(101, 67, 33),
		);
		applyPlotVisual(part, "Dirty");
		world.spawn(
			Components.GardenPlot({
				lastTouchedAt: os.clock(),
				part,
				plotId: plot.id,
				progress: 0,
				stage: "Dirty",
			}),
			Components.Interactable({
				kind: "Plot",
				part,
				prompt: "Needs scrap",
				radius: 10,
			}),
			Components.DecayState({ nextDecayAt: os.clock() + GARDEN_DECAY_TIME }),
		);
	}

	for (const pickup of seed.pickups) {
		const part = createGardenPart(
			folder,
			`${pickup.kind}Pickup`,
			pickup.position,
			new Vector3(3, 3, 3),
			Color3.fromRGB(255, 255, 255),
		);
		applyPickupVisual(part, pickup.kind, true);
		world.spawn(
			Components.ResourcePickup({
				amount: pickup.amount,
				kind: pickup.kind,
				part,
			}),
			Components.Interactable({
				kind: "Pickup",
				part,
				prompt: `Collect ${pickup.kind}`,
				radius: 9,
			}),
		);
	}

	for (const water of seed.waters) {
		const part = createGardenPart(
			folder,
			"WaterSource",
			water.position,
			new Vector3(6, 4, 6),
			Color3.fromRGB(90, 170, 255),
		);
		applyWaterVisual(part);
		world.spawn(
			Components.WaterSource({ part, uses: 9999 }),
			Components.Interactable({
				kind: "Water",
				part,
				prompt: "Collect water",
				radius: 10,
			}),
		);
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
