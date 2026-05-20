import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ServerState } from "@lisachandra/core/out/store";
import { getComponent } from "@lisachandra/matter";
import { GARDEN_DECAY_TIME } from "shared/game/constants";
import { createGardenSeed } from "server/game/seed";
import { applyPickupVisual, applyPlotVisual, applyWaterVisual, createGardenPart, ensureGardenFolder } from "server/game/helpers";

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
		getComponent("GardenProgress")({
			restoredPlots: 0,
			totalPlots: seed.plots.size(),
			harvested: 0,
			health: 0,
		}),
	);

	for (const plot of seed.plots) {
		const part = createGardenPart(folder, plot.id, plot.position, new Vector3(10, 1, 10), Color3.fromRGB(101, 67, 33));
		applyPlotVisual(part, "Dirty");
		world.spawn(
			getComponent("GardenPlot")({
				plotId: plot.id,
				part,
				stage: "Dirty",
				progress: 0,
				lastTouchedAt: os.clock(),
			}),
			getComponent("Interactable")({
				part,
				prompt: "Needs scrap",
				radius: 10,
				kind: "Plot",
			}),
			getComponent("DecayState")({ nextDecayAt: os.clock() + GARDEN_DECAY_TIME }),
		);
	}

	for (const pickup of seed.pickups) {
		const part = createGardenPart(folder, `${pickup.kind}Pickup`, pickup.position, new Vector3(3, 3, 3), Color3.fromRGB(255, 255, 255));
		applyPickupVisual(part, pickup.kind, true);
		world.spawn(
			getComponent("ResourcePickup")({
				part,
				kind: pickup.kind,
				amount: pickup.amount,
			}),
			getComponent("Interactable")({
				part,
				prompt: `Collect ${pickup.kind}`,
				radius: 9,
				kind: "Pickup",
			}),
		);
	}

	for (const water of seed.waters) {
		const part = createGardenPart(folder, "WaterSource", water.position, new Vector3(6, 4, 6), Color3.fromRGB(90, 170, 255));
		applyWaterVisual(part);
		world.spawn(
			getComponent("WaterSource")({ part, uses: 9999 }),
			getComponent("Interactable")({
				part,
				prompt: "Collect water",
				radius: 10,
				kind: "Water",
			}),
		);
	}

	world.commitCommands();
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
