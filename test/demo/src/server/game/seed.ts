import type { ResourceKind } from "shared/game/types";

export interface GardenPlotSeed {
	id: string;
	position: Vector3;
}

export interface GardenPickupSeed {
	amount: number;
	kind: Extract<ResourceKind, "Seed" | "Scrap">;
	position: Vector3;
}

export interface GardenWaterSeed {
	position: Vector3;
}

export interface GardenSeed {
	pickups: Array<GardenPickupSeed>;
	plots: Array<GardenPlotSeed>;
	waters: Array<GardenWaterSeed>;
}

export function createGardenSeed(): GardenSeed {
	return {
		pickups: [
			{ amount: 1, kind: "Scrap", position: new Vector3(-36, 2, 0) },
			{ amount: 1, kind: "Scrap", position: new Vector3(20, 2, 0) },
			{ amount: 1, kind: "Scrap", position: new Vector3(32, 2, 16) },
			{ amount: 1, kind: "Seed", position: new Vector3(-36, 2, 20) },
			{ amount: 1, kind: "Seed", position: new Vector3(20, 2, -20) },
			{ amount: 1, kind: "Seed", position: new Vector3(32, 2, -4) },
		],
		plots: [
			{ id: "plot-1", position: new Vector3(-24, 2, -12) },
			{ id: "plot-2", position: new Vector3(-8, 2, -12) },
			{ id: "plot-3", position: new Vector3(8, 2, -12) },
			{ id: "plot-4", position: new Vector3(-24, 2, 12) },
			{ id: "plot-5", position: new Vector3(-8, 2, 12) },
			{ id: "plot-6", position: new Vector3(8, 2, 12) },
		],
		waters: [{ position: new Vector3(-48, 2, -8) }, { position: new Vector3(40, 2, 8) }],
	};
}
