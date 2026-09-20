import type { CollectionData } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import { useDocument } from "@lisachandra/matter/hooks/useDocument";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";
import { None } from "@rbxts/sift";

interface TestData {
	credits: number;
	items: Array<string>;
}

const LOADING: never = None as never;

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

/** A minimal mock Player whose Parent is set so caching proceeds. */
function createMockPlayer(name: string): Player {
	return {
		Kick: () => {},
		Name: name,
		Parent: {} as Instance,
		UserId: 1,
	} as unknown as Player;
}

/**
 * Yields to the real scheduler and steps the dataforge virtual scheduler so deferred `load` work
 * can complete.
 */
async function advance(scheduler: dataforge.VirtualScheduler): Promise<void> {
	scheduler.step(0.1);
	await Promise.delay(1);
}

function isLoaded(key: string): boolean {
	const cached = store.documents[key];
	return cached !== undefined && cached !== (LOADING as unknown);
}

describe("useDocument", () => {
	it("should load profile, cache in store.documents, and clean up on close", async () => {
		expect.assertions(5);

		const { scheduler, store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_1");

		const result = useDocument(
			dfStore as unknown as dataforge.Store<CollectionData>,
			1,
			player,
		);

		expect(result.discriminator).toBe("Player_1");
		expect(result.document).toBeUndefined();

		// The sentinel is set synchronously; wait until a real profile is cached.
		for (let i = 0; i < 100 && !isLoaded("Player_1"); i++) {
			await advance(scheduler);
		}

		const cached = store.documents["Player_1"];

		expect(cached).toBeDefined();

		const profile = cached as unknown as dataforge.Profile<TestData>;

		expect(profile.get_data()).toEqual({ credits: 0, items: [] });

		// Simulate the profile closing: the cache entry should be removed.
		profile.unload();
		for (let i = 0; i < 100 && store.documents["Player_1"] !== undefined; i++) {
			await advance(scheduler);
		}

		expect(store.documents["Player_1"]).toBeUndefined();
	});

	it("should not double-load while a load is in flight", () => {
		expect.assertions(2);

		const { store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_2");

		// Simulate a document that is already loading.
		store.documents["Player_2"] = LOADING;

		const result = useDocument(
			dfStore as unknown as dataforge.Store<CollectionData>,
			2,
			player,
		);

		expect(result.document).toBeUndefined();
		expect(store.documents["Player_2"]).toBe(LOADING);
	});
});
