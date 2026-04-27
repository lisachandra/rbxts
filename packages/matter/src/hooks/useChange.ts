import { useHookState } from "@rbxts/matter";
import { equals } from "@rbxts/sift/out/Array";

interface Storage {
	dependencies?: Array<unknown>;
}

export function useChange(dependencies: Array<unknown>, discriminator?: unknown): boolean {
	const storage = useHookState<Storage>(discriminator);
	const previous = storage.dependencies;
	storage.dependencies = dependencies;

	return !previous || !equals(dependencies, previous);
}
