import { useHookState } from "@rbxts/matter";
import { equals } from "@rbxts/sift/Array";

interface Storage {
	dependencies?: Array<unknown>;
}

/**
 * Detects whether any dependency has changed since the last invocation.
 *
 * @param dependencies - An array of values to compare against the previous
 *   invocation.
 * @param discriminator - An optional value to distinguish between multiple hooks
 *   of the same type.
 * @returns `true` if any dependency changed, or on the first call; `false`
 *   otherwise.
 *
 * @example
 * ```ts
 * const healthChanged = useChange([entity.health]);
 * if (healthChanged) {
 *     playDamageSound();
 * }
 * ```
 *
 * @remarks
 * Uses shallow equality via `@rbxts/sift`'s `equals` to compare dependency
 * arrays. Always returns `true` on the first invocation.
 */
export function useChange(dependencies: Array<unknown>, discriminator?: unknown): boolean {
	const storage = useHookState<Storage>(discriminator);
	const previous = storage.dependencies;
	storage.dependencies = dependencies;

	return !previous || !equals(dependencies, previous);
}
