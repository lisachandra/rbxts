import { createCollection } from "@rbxts/lapis";

import type { CollectionData } from "@lisachandra/core/store";
import { createDataStoreValidator } from "./validate";

/**
 * Example Lapis collection for player data.
 *
 * **Copy this file into your game** and customize:
 * - The collection name (first argument to `createCollection`)
 * - The `defaultData` shape (must satisfy `CollectionData`)
 * - The `validate` schema (Serio-based via `createDataStoreValidator`)
 *
 * Then pass the collection to `configureRuntimeAdapters`:
 * ```ts
 * configureRuntimeAdapters({
 *   document: { collection },
 * });
 * ```
 */
export const collection = createCollection("PlayerData", {
	defaultData: {
		banned: { value: false },
		exploit: [],
		hotbar: [],
		inventory: [],
	} as CollectionData,

	validate: createDataStoreValidator<CollectionData>(),
});
