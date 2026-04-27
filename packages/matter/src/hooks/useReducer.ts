import { useHookState } from "@rbxts/matter";
import { equals } from "@rbxts/sift/out/Array";

interface Storage<S, A> {
	dependencies: Array<S>;
	dispatch: (action: A) => void;
	state: S;
}

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
