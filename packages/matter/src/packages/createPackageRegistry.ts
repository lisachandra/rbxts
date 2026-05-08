import { resolvePackageGraph } from "./resolvePackageGraph";
import type { MatterPackageDescriptor, MatterPackageRegistry } from "./types";

export function definePackage<
	TId extends string,
	TCrateState extends object = object,
	TStateKey extends string = string,
>(
	descriptor: MatterPackageDescriptor<TId, TCrateState, TStateKey>,
): MatterPackageDescriptor<TId, TCrateState, TStateKey> {
	return descriptor;
}

export function createPackageRegistry<
	TId extends string = string,
	TCrateState extends object = object,
	TStateKey extends string = string,
>(): MatterPackageRegistry<TId, TCrateState, TStateKey> {
	const packages = new Map<TId, MatterPackageDescriptor<TId, TCrateState, TStateKey>>();

	return {
		discover(predicate) {
			const discovered = new Array<MatterPackageDescriptor<TId, TCrateState, TStateKey>>();
			for (const [, pkg] of packages) {
				if (!predicate || predicate(pkg)) {
					discovered.push(pkg);
				}
			}

			return discovered;
		},
		entries() {
			return packages;
		},
		get(id) {
			return packages.get(id);
		},
		has(id) {
			return packages.has(id);
		},
		register(pkg) {
			if (packages.has(pkg.id)) {
				error(`[matter/packages] Package '${pkg.id}' is already registered.`);
			}

			packages.set(pkg.id, pkg);
			return this;
		},
		registerMany(list) {
			for (const pkg of list) {
				this.register(pkg);
			}

			return this;
		},
		resolve(requested) {
			return resolvePackageGraph(packages, requested);
		},
	};
}
