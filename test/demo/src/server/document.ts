import type { CollectionData } from "@lisachandra/core/store";
import { createDataStoreValidator } from "@lisachandra/platform/document/validate";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import { createCollection } from "@rbxts/lapis";

declare module "@lisachandra/core/store" {
	interface CollectionData {
		controls: Array<number>;
		stats: {
			totalHarvested: number;
			totalCleared: number;
			bestGardenHealth: number;
		};
		settings: {
			showWorldMarkers: boolean;
			showNotifications: boolean;
		};
	}
}

export const gardenDocumentDefaults: CollectionData = {
	controls: [],
	stats: {
		totalHarvested: 0,
		totalCleared: 0,
		bestGardenHealth: 0,
	},
	settings: {
		showWorldMarkers: true,
		showNotifications: true,
	},
};

configureRuntimeAdapters({
	document: {
		collection: createCollection("PlayerData", {
			defaultData: gardenDocumentDefaults,
			validate: createDataStoreValidator<CollectionData>(),
		}),
	},
});
