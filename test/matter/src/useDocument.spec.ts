import type { CollectionData } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import { useDocument } from "@lisachandra/matter/hooks/useDocument";
import dataforge from "@rbxts/dataforge";
import { describe, expect, it } from "@rbxts/jest-globals";
import { None } from "@rbxts/sift";

/*
 * Ported from the godkin repo's `server/document/use.spec.ts` (#17 triage: rewrite).
 *
 * The upstream spec mocked the Lapis collection and the store module wholesale, then asserted that
 * `collection.load` had been called. This repo's hook takes the dataforge store as a parameter
 * instead of importing a module-level collection, so the spec can pass a real memory-backed store
 * and observe an actual profile rather than a mock's call log.
 *
 * What survived the rewrite: the discriminator, the "no document on the first call" contract, the
 * cache reuse, and the close-driven cleanup. What the rewrite adds: the two paths that skip the
 * cache write — a player who leaves mid-load, and a call with no player at all — and the bounded
 * retry after a failed load. All three were defects in the first port (#76); these specs now assert
 * the fixed contracts.
 */

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

/*
 * A minimal mock Player whose Parent is set so caching proceeds.
 *
 * `Kick` takes the receiver explicitly: roblox-ts compiles `player:Kick(message)` to a method call
 * whose first argument is the player, so the mock's first parameter has to be the player itself.
 * Nothing exercised this until the attempt-limit spec did, which is how the mistake survived.
 */
function createMockPlayer(name: string, kicks: Array<string> = []): Player {
	return {
		Kick: (_self: Player, message: string) => {
			kicks.push(message);
		},
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
	await Promise.delay(0.02);
}

function isLoaded(key: string): boolean {
	const cached = store.documents[key];
	return cached !== undefined && cached !== (LOADING as unknown);
}

/*
 * A load hops through several scheduler turns, so the loop budget is generous. The step size is
 * small on purpose: a short case then does not have to wait out a long one's budget, and the whole
 * file stays well inside the emulator's 30-second wall-clock cap.
 */
async function settle(scheduler: dataforge.VirtualScheduler, key: string): Promise<boolean> {
	for (let i = 0; i < 120 && !isLoaded(key); i++) {
		await advance(scheduler);
	}

	return isLoaded(key);
}

describe("useDocument", () => {
	it("should answer the discriminator and no document on the first call", () => {
		expect.assertions(3);

		const { store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_11");

		/*
		 * The first call always answers `undefined`, even though it starts the load. A caller that
		 * expected a synchronous document would have to handle a partially-populated value; instead the
		 * contract is "undefined until cached, then the profile".
		 */
		const result = useDocument(
			dfStore as unknown as dataforge.Store<CollectionData>,
			11,
			player,
		);

		expect(result.discriminator).toBe("Player_11");
		expect(result.document).toBeUndefined();
		expect(store.documents.Player_11).toBe(LOADING);
	});

	it("should answer a cached document on a later call", async () => {
		expect.assertions(2);

		const { scheduler, store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_12");
		const typed = dfStore as unknown as dataforge.Store<CollectionData>;

		useDocument(typed, 12, player);

		expect(await settle(scheduler, "Player_12")).toBe(true);

		const second = useDocument(typed, 12, player);

		/*
		 * No second load is started: the discriminator was already cached, so the early return hands
		 * back the profile. That is what makes the hook cheap to call every frame.
		 */
		expect(second.document).toBeDefined();
	});

	it("should drop the cache entry when the profile closes", async () => {
		expect.assertions(3);

		const { scheduler, store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_13");

		useDocument(dfStore as unknown as dataforge.Store<CollectionData>, 13, player);

		expect(await settle(scheduler, "Player_13")).toBe(true);

		const profile = store.documents.Player_13 as unknown as dataforge.Profile<TestData>;

		/*
		 * The cached object is a real profile over the template, not a placeholder: `get_data` is the
		 * accessor callers will use, so a cache holding anything else would be a lie that later reads
		 * would expose.
		 */
		expect(profile.get_data()).toEqual({ credits: 0, items: [] });

		profile.unload();

		for (let i = 0; i < 60 && store.documents.Player_13 !== undefined; i++) {
			await advance(scheduler);
		}

		/*
		 * `on_closed` deletes the entry. If it did not, a rejoining player would keep the closed
		 * profile and every read would raise `profile_closed`.
		 */
		expect(store.documents.Player_13).toBeUndefined();
	});

	it("should cache exactly one profile per discriminator", async () => {
		expect.assertions(2);

		const { scheduler, store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_14");
		const typed = dfStore as unknown as dataforge.Store<CollectionData>;

		/*
		 * Calling the hook twice before the load resolves is the realistic pattern — a system may run
		 * every frame — and it must not take the lock twice. The second call sees the sentinel and
		 * returns; only the first ever calls `load`.
		 */
		useDocument(typed, 14, player);
		const duringLoad = useDocument(typed, 14, player);

		expect(duringLoad.document).toBeUndefined();

		expect(await settle(scheduler, "Player_14")).toBe(true);
	});

	/*
	 * The three specs below cover the paths the godkin suite never reached, because its assertions
	 * either stopped at "`load` was called" or depended on a mocked collection that resolved on
	 * demand.
	 *
	 * The first two share a shape: the load finishes but the cache write is skipped. The first port
	 * left the `LOADING` sentinel in the slot, which made the discriminator permanently unusable —
	 * a later call saw the sentinel, decided a load was in flight, and started nothing. The slot is
	 * now cleared, so the next call loads again (#76).
	 */
	it("should clear the loading sentinel when the player leaves mid-load", async () => {
		expect.assertions(2);

		const { scheduler, store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_15");

		useDocument(dfStore as unknown as dataforge.Store<CollectionData>, 15, player);
		player.Parent = undefined as never;

		// Enough steps for the load to have resolved and the "player has gone" branch to run.
		for (const _ of $range(0, 40)) {
			await advance(scheduler);
		}

		expect(isLoaded("Player_15")).toBe(false);

		/*
		 * `undefined`, not the sentinel: the abandoned load releases its claim, so a returning player
		 * gets a fresh load rather than a slot nobody will ever fill.
		 */
		expect(store.documents.Player_15).toBeUndefined();
	});

	it("should load a document when called without a player", async () => {
		expect.assertions(3);

		const { scheduler, store: dfStore } = createTestStore();
		const typed = dfStore as unknown as dataforge.Store<CollectionData>;

		/*
		 * Omitting the player means "load without a kick target", not "the player has left". Reading
		 * the two the same way made this overload unable to answer a document, ever.
		 */
		const result = useDocument(typed, 16);

		expect(result.discriminator).toBe("Player_16");
		expect(await settle(scheduler, "Player_16")).toBe(true);

		// The second call now observes the cached profile, which the old implementation could not.
		expect(useDocument(typed, 16).document).toBeDefined();
	});

	/*
	 * A failed load has to be retried, but not without limit: `waitForPlayerLoaded` polls this hook
	 * once a second and a render loop can poll it every frame, so an unconditional reset would turn a
	 * DataStore outage into a load storm. A closed store is the failure this spec can produce
	 * deterministically — `load` answers `store_closed` without yielding.
	 */
	it("should stop retrying and kick the player once the attempt limit is reached", async () => {
		expect.assertions(3);

		const kicks = new Array<string>();
		const { store: dfStore } = createTestStore();
		const player = createMockPlayer("Player_17", kicks);
		const typed = dfStore as unknown as dataforge.Store<CollectionData>;

		dfStore.close();

		/*
		 * Four calls for three attempts: the first three each start a load, the fourth finds the
		 * bound already reached and returns without touching the store.
		 */
		for (let round = 0; round < 4; round++) {
			useDocument(typed, 17, player);

			for (let step = 0; step < 4; step++) {
				await Promise.delay(0.02);
			}
		}

		// The slot is free after every failure, so nothing is left claiming a load.
		expect(store.documents.Player_17).toBeUndefined();
		// The player still in the server is told to rejoin rather than left waiting forever.
		expect(kicks.size()).toBe(1);
		expect(kicks[0]).toBe("Document failed to load, please rejoin");
	});
});
