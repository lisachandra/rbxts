import { useHookState } from "@rbxts/matter";
import { equals } from "@rbxts/sift/out/Array";

interface Storage {
	dependencies: Array<unknown>;
	value: Array<unknown>;
}

type PartialStorage =
	| (Storage & { initialized: true })
	| (Partial<Storage> & { initialized?: false });

const unpackTable: LuaGlobals["unpack"] = getfenv(0)["unpack" as never];

/**
 * Memoizes a computed value, recomputing only when dependencies change.
 *
 * @param callback - A function that returns the value to memoize.
 * @param dependencies - An array of values to compare against previous values.
 * @param discriminator - An optional value to distinguish between multiple hooks
 *   of the same type.
 * @returns The memoized value.
 *
 * @example
 * ```ts
 * const health = useMemo(
 *     () => calculateHealth(entity),
 *     [entity.maxHp, entity.currentHp]
 * );
 * ```
 *
 * @remarks
 * Uses shallow equality via `@rbxts/sift`'s `equals` to compare dependency arrays.
 */
export function useMemo<T>(
	callback: () => T,
	dependencies: Array<unknown>,
	discriminator?: unknown,
): T {
	const storage = useHookState<PartialStorage>(discriminator);

	if (!("initialized" in storage) || !equals(dependencies, storage.dependencies ?? [])) {
		storage.initialized = true;
		storage.dependencies = dependencies;
		storage.value = [callback()];
	}

	return unpackTable(storage.value) as T;
}
