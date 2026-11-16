import type { CollectionData } from "@lisachandra/core/store";
import { configureRuntimeAdapters, getDocumentConfig } from "@lisachandra/matter";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

function createStore(): dataforge.Store<CollectionData> {
	const scheduler = dataforge.schedulers.virtual.create();
	const hook = dataforge.hooks.memory.create(scheduler);

	return dataforge.create_store({
		_hook: hook,
		_scheduler: scheduler,
		name: "DocumentConfigSpec",
		template: { hotbar: [], inventory: [] },
	} as never) as dataforge.Store<CollectionData>;
}

describe("documentConfig", () => {
	it("should return exactly the document handle it was configured with", () => {
		expect.assertions(2);

		const dfStore = createStore();
		configureRuntimeAdapters({ document: { store: dfStore } });

		const config = getDocumentConfig();

		expect(config).toBeDefined();
		/*
		 * Exactly one key: the config has no synthesized `persistedComponents` map and no default
		 * that the type used to imply.
		 */
		expect(config).toEqual({ store: dfStore });
	});
});
