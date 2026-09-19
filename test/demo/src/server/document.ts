import type { CollectionData } from "@lisachandra/core/store";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import dataforge from "@rbxts/dataforge";

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

const storeConfig = {
	name: "PlayerData",
	template: gardenDocumentDefaults,
} as const;

let testScheduler: undefined | dataforge.VirtualScheduler;

export const gardenStore: dataforge.Store<CollectionData> = (() => {
	if (_G.__TEST__ ?? false) {
		// In-memory hook + virtual scheduler so tests never touch real DataStores.
		testScheduler = dataforge.schedulers.virtual.create();
		const hook = dataforge.hooks.memory.create(testScheduler);
		return dataforge.create_store({
			...storeConfig,
			_hook: hook,
			_scheduler: testScheduler,
		} as never) as dataforge.Store<CollectionData>;
	}

	return dataforge.create_store(storeConfig);
})();

void testScheduler;

configureRuntimeAdapters({
	document: {
		store: gardenStore,
	},
});
