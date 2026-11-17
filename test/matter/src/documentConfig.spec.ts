import type { CollectionData } from "@lisachandra/core/store";
import type { DocumentConfig } from "@lisachandra/matter";
import { configureRuntimeAdapters, getDocumentConfig, getDocumentStore } from "@lisachandra/matter";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

function createStore(name: string): dataforge.Store<CollectionData> {
	const scheduler = dataforge.schedulers.virtual.create();
	const hook = dataforge.hooks.memory.create(scheduler);

	return dataforge.create_store({
		_hook: hook,
		_scheduler: scheduler,
		name,
		template: { hotbar: [], inventory: [] },
	} as never) as dataforge.Store<CollectionData>;
}

describe("documentConfig", () => {
	it("should return exactly the document handle it was configured with", () => {
		expect.assertions(2);

		const dfStore = createStore("ConfiguredHandle");
		configureRuntimeAdapters({ document: { store: dfStore } });

		const config = getDocumentConfig();

		expect(config).toBeDefined();
		/*
		 * Exactly one key: the config carries no synthesized map and no default the type used to
		 * imply, so what a game passes is what `getDocumentConfig` returns.
		 */
		expect(config).toEqual({ store: dfStore });
	});
});

describe("documentConfig union", () => {
	/*
	 * Compile-time half of the contract. `test/matter` is a project reference of the root
	 * tsconfig, so `pnpm typecheck` is the runner: an unused `@ts-expect-error` (TS2578) fails it,
	 * which makes both arms below a real gate rather than a comment.
	 */
	it("should not express a config that names neither handle", () => {
		expect.assertions(1);

		// @ts-expect-error - `{}` is not assignable to either arm of the union
		const neither: DocumentConfig = {};

		expect(neither).toEqual({});
	});

	it("should not express a config that names both handles", () => {
		expect.assertions(1);

		const dfStore = createStore("BothHandles");
		// @ts-expect-error - `store?: never` / `collection?: never` together reject both handles
		const both: DocumentConfig = { collection: dfStore, store: dfStore };

		expect(both).toBeDefined();
	});
});

describe("getDocumentStore", () => {
	it("should resolve the store variant to the configured store", () => {
		expect.assertions(2);

		const dfStore = createStore("StoreVariant");
		configureRuntimeAdapters({ document: { store: dfStore } });

		const resolved = getDocumentStore(getDocumentConfig());

		expect(resolved).toBe(dfStore);

		// The resolved handle is a live Dataforge store, not merely an identity match.
		const profile = resolved!.load("Player_1", [1]).unwrap();

		expect(profile.get_data()).toEqual({ hotbar: [], inventory: [] });

		profile.unload();
	});

	it("should resolve the collection variant to the configured store", () => {
		expect.assertions(2);

		const dfStore = createStore("CollectionVariant");
		configureRuntimeAdapters({ document: { collection: dfStore } });

		const resolved = getDocumentStore(getDocumentConfig());

		expect(resolved).toBe(dfStore);

		const profile = resolved!.load("Player_2", [2]).unwrap();

		expect(profile.get_data()).toEqual({ hotbar: [], inventory: [] });

		profile.unload();
	});
});
