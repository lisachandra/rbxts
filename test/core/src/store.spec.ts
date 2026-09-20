import { store } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";

interface TestData {
	credits: number;
	items: Array<string>;
}

function createTestStore(): {
	scheduler: dataforge.VirtualScheduler;
	store: dataforge.Store<TestData>;
} {
	const scheduler = dataforge.schedulers.virtual.create();
	const hook = dataforge.hooks.memory.create(scheduler);
	const dfStore = dataforge.create_store({
		_hook: hook,
		_scheduler: scheduler,
		name: "TestStore",
		template: { credits: 0, items: [] },
	} as never) as dataforge.Store<TestData>;
	return { scheduler, store: dfStore };
}

describe("store documents middleware", () => {
	it("should immutably write a dataforge profile when a crate document is removed", async () => {
		expect.assertions(2);

		const { store: dfStore } = createTestStore();
		const profile = dfStore.load("Player_1", [1]).unwrap();
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

describe("dataforge store integration", () => {
	it("should load, update immutably, and unload profile in dataforge", () => {
		expect.assertions(4);

		const { scheduler, store: dfStore } = createTestStore();
		const profile = dfStore.load("Player_2", [2]).unwrap();

		expect(profile.get_data()).toEqual({ credits: 0, items: [] });

		const updated = profile
			.update((data) => ({ ...data, credits: data.credits + 10 }))
			.unwrap();

		expect(updated).toBe(true);
		expect(profile.get_data()).toEqual({ credits: 10, items: [] });

		profile.unload();
		scheduler.step(0.1);

		expect(profile.open).toBe(false);
	});

	it("should execute cross-key transaction atomically via dataforge", () => {
		expect.assertions(3);

		const { scheduler, store: dfStore } = createTestStore();
		const sender = dfStore.load("Player_3", [3]).unwrap();
		const receiver = dfStore.load("Player_4", [4]).unwrap();

		const success = dfStore.transaction([sender, receiver], (allData) => {
			const [senderData, receiverData] = allData as [TestData, TestData];

			return [
				{ ...senderData, credits: senderData.credits - 5 },
				{ ...receiverData, credits: receiverData.credits + 5 },
			];
		});

		expect(success.unwrap()).toBe(true);
		expect(sender.get_data()).toEqual({ credits: -5, items: [] });
		expect(receiver.get_data()).toEqual({ credits: 5, items: [] });

		sender.unload();
		receiver.unload();
		scheduler.step(0.1);
	});
});
