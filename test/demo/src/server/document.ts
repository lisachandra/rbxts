import type { CollectionData } from "@lisachandra/core/store";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import { createDataStoreValidator } from "@lisachandra/platform/document/validate";
import { createCollection } from "@rbxts/lapis";

declare module "@lisachandra/core/store" {
	interface CollectionData {
		controls: Array<number>;
		settings: {
			showNotifications: boolean;
			showWorldMarkers: boolean;
		};
		stats: {
			bestGardenHealth: number;
			totalCleared: number;
			totalHarvested: number;
		};
	}
}

export const gardenDocumentDefaults: CollectionData = {
	controls: [],
	settings: {
		showNotifications: true,
		showWorldMarkers: true,
	},
	stats: {
		bestGardenHealth: 0,
		totalCleared: 0,
		totalHarvested: 0,
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
