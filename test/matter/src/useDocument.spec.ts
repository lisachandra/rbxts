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
 * cache write — a player who leaves mid-load, and a call with no player at all — because both leave
 * a permanent `LOADING` sentinel behind. Those are pinned as observations, not contracts.
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

/** A minimal mock Player whose Parent is set so caching proceeds. */
function createMockPlayer(name: string, kicks: Array<string> = []): Player {
	return {
		Kick: (message: string) => {
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
	 * The two specs below pin behaviour the godkin suite never reached, because its assertions either
	 * stopped at "`load` was called" or depended on a mocked collection that resolved on demand.
	 *
	 * Both describe the same shape: the early `return` inside the `then` skips the cache write, but
	 * nothing clears the `LOADING` sentinel placed before the load. The entry is therefore permanent
	 * for that discriminator — a later call for the same player sees `LOADING`, decides the load is
	 * already in flight, and starts nothing. A player who leaves and rejoins within one server
	 * lifetime is never loaded again.
	 *
	 * That is a defect, not a contract, and it is pinned here rather than asserted as correct so that
	 * a fix has to update this spec deliberately. See #76.
	 */
	it("should leave the loading sentinel behind when the player leaves mid-load", async () => {
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
		// The sentinel, not `undefined`: nothing resets the slot the load was tracking.
		expect(store.documents.Player_15).toBe(LOADING);
	});

	it("should leave the loading sentinel behind when called without a player", async () => {
		expect.assertions(3);

		const { scheduler, store: dfStore } = createTestStore();

		/*
		 * `!player?.Parent` is true when `player` is nil, so the no-player overload takes the same
		 * branch as a player who left: the profile is unloaded and never cached. The overload looks
		 * like "load without a kick target", but it can never hand a document back.
		 */
		const result = useDocument(dfStore as unknown as dataforge.Store<CollectionData>, 16);

		expect(result.discriminator).toBe("Player_16");

		for (const _ of $range(0, 40)) {
			await advance(scheduler);
		}

		expect(isLoaded("Player_16")).toBe(false);
		expect(store.documents.Player_16).toBe(LOADING);
	});
});
