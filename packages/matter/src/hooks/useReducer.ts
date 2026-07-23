import { useHookState } from "@rbxts/matter";
import { equals } from "@rbxts/sift/Array";

interface Storage<S, A> {
	dependencies: Array<S>;
	dispatch: (action: A) => void;
	state: S;
}

/**
 * Manages complex state with a reducer function, similar to React's
 * `useReducer`.
 *
 * @param reducer - A pure function that takes the current state and an action,
 *   returning new state.
 * @param initialState - The initial state value.
 * @param discriminator - An optional value to distinguish between multiple hooks
 *   of the same type.
 * @returns A tuple of `[state, dispatchFn]`.
 *
 * @example
 * ```ts
 * const [count, dispatch] = useReducer(
 *     (state: number, action: "inc" | "dec") => {
 *         if (action === "inc") return state + 1;
 *         return state - 1;
 *     },
 *     0
 * );
 * dispatch("inc");
 * ```
 *
 * @remarks
 * The dispatch function is recreated only when the state changes, ensuring
 * stable references across renders.
 */
export function useReducer<S, A>(
	reducer: (state: S, action: A) => S,
	initialState: S,
	discriminator?: unknown,
): [state: S, dispatchFn: (action: A) => void] {
	const storage: Storage<S, A> = useHookState(discriminator);

	storage.state ??= initialState;

	const dependencies = [storage.state];

	if (!equals(dependencies, storage.dependencies ?? [])) {
		storage.dependencies = dependencies;
		storage.dispatch = (action: A) => {
			storage.state = reducer(storage.state, action);
		};
	}

	return [storage.state, storage.dispatch];
}
