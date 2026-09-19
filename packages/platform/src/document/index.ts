import dataforge from "@rbxts/dataforge";

/**
 * Creates an in-memory dataforge store for tests.
 *
 * @remarks
 *   Wires a virtual scheduler and memory hook so tests can exercise store loads, profile updates
 *   and transactions without touching real DataStores. Stepping the returned scheduler drives
 *   deferred load/write work to completion.
 * @typeParam T - The data shape stored in the store.
 * @param config - The public store configuration (name and template).
 * @returns The store, memory hook and virtual scheduler used to construct it.
 */
export function createTestStore<T>(
	config: dataforge.Config<T> & { _hook?: never; _scheduler?: never },
): {
	hook: dataforge.MemoryHook;
	scheduler: dataforge.VirtualScheduler;
	store: dataforge.Store<T>;
} {
	const scheduler = dataforge.schedulers.virtual.create();
	const hook = dataforge.hooks.memory.create(scheduler);
	const store = dataforge.create_store({
		...config,
		_hook: hook,
		_scheduler: scheduler,
	} as never) as dataforge.Store<T>;

	return { hook, scheduler, store };
}

export * from "./validate";
