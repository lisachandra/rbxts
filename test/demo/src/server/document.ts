import { CollectionData } from "@lisachandra/core/out/store";
import { createDataStoreValidator } from "@lisachandra/platform/out/document/validate";
import { configureRuntimeAdapters } from "@lisachandra/matter";
import { createCollection } from "@rbxts/lapis";

declare module "@lisachandra/core/out/store" {
	interface CollectionData {
		controls: Array<number>
	}
}

configureRuntimeAdapters({
	document: {
		collection: createCollection("PlayerData", {
			defaultData: { controls: [] } as CollectionData,
			validate: createDataStoreValidator<CollectionData>(),
		}),
	}
})
