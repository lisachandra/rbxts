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
