import type { MatterPackageDescriptor, ResolvedMatterPackageGraph } from "./types";

export function resolvePackageGraph<
	TId extends string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
>(
	packages: ReadonlyMap<TId, MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>,
	requested: ReadonlyArray<TId>,
): ResolvedMatterPackageGraph<TId, TSystem, TCrateState, TStateKey> {
	const order = new Array<MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>();
	const visiting = new Set<TId>();
	const visited = new Set<TId>();
	const index = new Map<TId, MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>();

	const visit = (id: TId, path = new Array<TId>()): void => {
		if (visited.has(id)) {
			return;
		}

		if (visiting.has(id)) {
			error(`[matter/packages] Cyclic package dependency detected: ${[...path, id].join(" -> ")}`);
		}

		const pkg = packages.get(id);
		if (!pkg) {
			error(`[matter/packages] Missing package dependency '${id}'.`);
		}

		visiting.add(id);
		for (const dependency of pkg.dependencies ?? []) {
			visit(dependency, [...path, id]);
		}

		visiting.delete(id);
		visited.add(id);
		index.set(id, pkg);
		order.push(pkg);
	};

	for (const id of requested) {
		visit(id);
	}

	return {
		index,
		order,
		requested: [...requested],
	};
}
