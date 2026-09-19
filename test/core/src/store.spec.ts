import { store } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

interface TestData {
	credits: number;
	items: Array<string>;
}

function createTestStore(): dataforge.Store<TestData> {
	const scheduler = dataforge.schedulers.virtual.create();
	const hook = dataforge.hooks.memory.create(scheduler);
	return dataforge.create_store({
		_hook: hook,
		_scheduler: scheduler,
		name: "TestStore",
		template: { credits: 0, items: [] },
	} as never) as dataforge.Store<TestData>;
}

describe("store documents middleware", () => {
	it("should immutably write a dataforge profile when a crate document is removed", async () => {
		expect.assertions(2);

		const dfStore = createTestStore();
		const profile = dfStore.load("Player_1", [1]);
		store.documents["Player_1"] = profile;

		const server = store.server as unknown as Crate<{
			documents: Record<string, TestData>;
		}>;

		// Seed the crate with the player's document data.
		await server
			.update({
				documents: () => ({ Player_1: { credits: 100, items: ["sword"] } }),
			})
			.await();

		/*
		 * Removing the key counts as a difference: the middleware writes the
		 * removed value (immutably) into the matching dataforge profile.
		 */
		await server
			.update({
				documents: (documents) => {
					const updated = { ...documents };
					delete updated["Player_1"];
					return updated;
				},
			})
			.await();

		expect(profile.get_data()).toEqual({ credits: 100, items: ["sword"] });

		profile.unload();

		expect(profile.open).toBe(false);
	});
});
