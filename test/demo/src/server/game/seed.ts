import type { ResourceKind } from "shared/game/types";

export interface GardenPlotSeed {
	id: string;
	position: Vector3;
}

export interface GardenPickupSeed {
	kind: Extract<ResourceKind, "Scrap" | "Seed">;
	position: Vector3;
	amount: number;
}

export interface GardenWaterSeed {
	position: Vector3;
}

export interface GardenSeed {
	plots: Array<GardenPlotSeed>;
	pickups: Array<GardenPickupSeed>;
	waters: Array<GardenWaterSeed>;
}

export function createGardenSeed(): GardenSeed {
	return {
		plots: [
			{ id: "plot-1", position: new Vector3(-24, 2, -12) },
			{ id: "plot-2", position: new Vector3(-8, 2, -12) },
			{ id: "plot-3", position: new Vector3(8, 2, -12) },
			{ id: "plot-4", position: new Vector3(-24, 2, 12) },
			{ id: "plot-5", position: new Vector3(-8, 2, 12) },
			{ id: "plot-6", position: new Vector3(8, 2, 12) },
		],
		pickups: [
			{ kind: "Scrap", position: new Vector3(-36, 2, 0), amount: 1 },
			{ kind: "Scrap", position: new Vector3(20, 2, 0), amount: 1 },
			{ kind: "Scrap", position: new Vector3(32, 2, 16), amount: 1 },
			{ kind: "Seed", position: new Vector3(-36, 2, 20), amount: 1 },
			{ kind: "Seed", position: new Vector3(20, 2, -20), amount: 1 },
			{ kind: "Seed", position: new Vector3(32, 2, -4), amount: 1 },
		],
		waters: [{ position: new Vector3(-48, 2, -8) }, { position: new Vector3(40, 2, 8) }],
	};
}
