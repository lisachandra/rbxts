import { type AnySystem, findSystems, start } from "@lisachandra/matter";
import { createPackageRegistry, createPackageRuntime } from "@lisachandra/matter";
import type { MatterPackageDescriptor } from "@lisachandra/matter/out/packages";
import { RunService } from "@rbxts/services";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Options for configuring the Matter ECS bootstrap process.
 *
 * @remarks
 * Combines pre-resolved systems, auto-collected Flamework barrels,
 * hot-reload containers, and ad-hoc extensions into a single boundary
 * passed to the Matter loop.
 */
export interface BootstrapOptions {
	/**
	 * `"development"` enables Rewire hot reload via the Matter Loop.
	 * Defaults to `"production"`.
	 */
	mode?: "development" | "production";

	/**
	 * Barrel modules (Flamework namespaces) whose `@meta`-annotated
	 * systems are auto-collected via `findSystems()`.
	 */
	modules?: {
		client?: object;
		server?: object;
		shared?: object;
	};

	/**
	 * Pre-resolved systems from the pipeline or package registry
	 * (Paths A / B / C in the bootstrap chain).
	 */
	systems?: Array<AnySystem>;

	/**
	 * Hot reload containers (Rewire `Folder` instances).
	 * Only meaningful when `mode === "development"`.
	 */
	hotReload?: {
		containers?: Array<Instance>;
	};

	/**
	 * Ad-hoc user extensions — extra systems, modules, or containers
	 * merged into the final boundary automatically.
	 */
	packages?: Array<MatterPackageDescriptor>;

	extensions?: {
		containers?: Array<Instance>;
		modules?: Array<object>;
		systems?: Array<AnySystem>;
	};
}

/**
 * Resolved boundary produced from {@link BootstrapOptions}.
 *
 * @remarks
 * This is the normalized input that `start()` receives after
 * `resolveBoundary` merges all configured sources.
 */
export interface BootstrapBoundary {
	containers: Array<Instance>;
	mode: "development" | "production";
	systems: Array<AnySystem>;
}

/**
 * Return value of {@link bootstrap}, providing access to the Matter
 * world, crate, loop, and the resolved boundary used.
 */
export type BootstrapResult = ReturnType<typeof start> & {
	/** The resolved boundary used — useful for debugging or reusing. */
	boundary: BootstrapBoundary;
}

function collectSystems(modules: Array<object>): Array<AnySystem> {
	const systems = new Array<AnySystem>();
	for (const container of modules) {
		for (const s of findSystems(container, [])) {
			systems.push(s);
		}
	}
	return systems;
}

/**
 * Merges all configured system/module/container sources into a single
 * {@link BootstrapBoundary} suitable for `start()`.
 *
 * @param options - The bootstrap options specifying mode, modules,
 *   systems, hot-reload containers, and extensions.
 * @returns A resolved boundary with the final system list, mode, and
 *   containers.
 */
export function resolveBoundary(options: BootstrapOptions = {}): BootstrapBoundary {
	const mode = options.mode ?? "production";
	const scope = RunService.IsClient() ? "client" : "server";

	const deferModuleSystemsToHotReload =
		mode === "development" && options.hotReload?.containers !== undefined && options.hotReload.containers.size() > 0;

	const allSystems = new Array<AnySystem>();

	// 1. Pre-resolved systems (pipeline / packages output)
	if (options.systems) {
		for (const s of options.systems) {
			allSystems.push(s);
		}
	}

	// 2. Auto-collected systems from Flamework barrel modules
	if (options.modules && !deferModuleSystemsToHotReload) {
		if (options.modules.shared) {
			for (const s of findSystems(options.modules.shared)) {
				allSystems.push(s);
			}
		}
		const scopeModule = options.modules[scope];
		if (scopeModule) {
			for (const s of findSystems(scopeModule)) {
				allSystems.push(s);
			}
		}
	}

	// 3. Extension modules & systems
	if (options.extensions) {
		if (options.extensions.modules) {
			for (const s of collectSystems(options.extensions.modules)) {
				allSystems.push(s);
			}
		}
		if (options.extensions.systems) {
			for (const s of options.extensions.systems) {
				allSystems.push(s);
			}
		}
	}

	// 4. Package descriptors (builtin or third-party)
	if (options.packages) {
		const registry = createPackageRegistry();
		for (const pkg of options.packages) {
			registry.register(pkg);
		}
		const allIds = new Array<string>();
		for (const [id] of registry.entries()) {
			allIds.push(id);
		}
		const resolved = registry.resolve(allIds);
		const runtime = createPackageRuntime(resolved as never);
		for (const s of runtime.buildSystems()) {
			allSystems.push(s as AnySystem);
		}
	}

	// Build container list
	const containers = new Array<Instance>();
	if (mode === "development" && options.hotReload?.containers) {
		for (const c of options.hotReload.containers) {
			containers.push(c);
		}
	}
	if (options.extensions?.containers) {
		for (const c of options.extensions.containers) {
			containers.push(c);
		}
	}

	return { containers, mode, systems: allSystems };
}

/**
 * Single bootstrap entry point — works on both client and server.
 *
 * @example
 * ```ts
 * // Full pipeline path
 * const systems = createPipeline().use(families).build();
 * const { world, crate, loop } = bootstrap({ mode: "development", systems });
 * ```
 *
 * @example
 * ```ts
 * // Auto-collect from Flamework barrels (no pipeline)
 * // Include builtin matter systems via packages
 * const { world, crate } = bootstrap({
 *   packages: [builtinPackage],
 *   modules: { server: systems, shared: sharedSystems },

 * ```
 */
export function bootstrap(options: BootstrapOptions = {}): BootstrapResult {
	const boundary = resolveBoundary(options);

	const runtime = start({
		systems: boundary.systems,
		containers: boundary.containers,
	});

	return {
		world: runtime.world,
		crate: runtime.crate,
		loop: runtime.loop,
		debugger: runtime.debugger,
		boundary,
	};
}
