import { createPipeline } from "../pipeline";
import type { PipelineRegistration } from "../pipeline";
import type { ReplicationBuilder, ReplicationComponentRegistration } from "../replication";

import type {
	MatterPackageRuntime,
	MatterPackageStateManager,
	MatterPackageStateSlice,
	ResolvedMatterPackageGraph,
} from "./types";

function createStateManager<TCrateState extends object, TStateKey extends string>(
	stateSlices: ReadonlyArray<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>,
): MatterPackageStateManager<TCrateState, TStateKey> {
	return {
		collect(crate) {
			const collected = {} as Record<TStateKey, unknown>;
			for (const slice of stateSlices) {
				if (slice.key in collected) {
					error(`[matter/packages] Duplicate package state key '${slice.key}'.`);
				}

				collected[slice.key] = slice.create(crate);
			}

			return collected;
		},
		entries() {
			return [...stateSlices];
		},
	};
}

export function createPackageRuntime<
	TId extends string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
>(
	resolved: ResolvedMatterPackageGraph<TId, TSystem, TCrateState, TStateKey>,
): MatterPackageRuntime<TId, TSystem, TCrateState, TStateKey> {
	const pipelineRegistrations = new Array<PipelineRegistration<TSystem>>();
	const replicationComponents = new Array<ReplicationComponentRegistration>();
	const replicationConfigurators = new Array<(builder: ReplicationBuilder<TSystem>) => void>();
	const stateSlices = new Array<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>();

	for (const pkg of resolved.order) {
		for (const registration of pkg.pipeline ?? []) {
			pipelineRegistrations.push(registration);
		}

		for (const registration of pkg.replication?.templates ?? []) {
			pipelineRegistrations.push(registration);
		}

		for (const component of pkg.replication?.components ?? []) {
			replicationComponents.push(component);
		}

		const configureReplication = pkg.replication?.configure;
		if (configureReplication !== undefined) {
			replicationConfigurators.push((builder) => configureReplication(builder));
		}

		for (const state of pkg.state ?? []) {
			stateSlices.push(state);
		}
	}

	const state = createStateManager(stateSlices);

	return {
		buildSystems(builder = createPipeline<TSystem>()) {
			this.installPipeline(builder);
			return builder.build();
		},
		installPipeline(builder) {
			for (const registration of pipelineRegistrations) {
				builder.use(registration);
			}

			return builder;
		},
		installReplication(builder) {
			for (const component of replicationComponents) {
				const options: Omit<ReplicationComponentRegistration, "component"> = {};
				if (component.mode !== undefined) {
					options.mode = component.mode;
				}

				if (component.notes !== undefined) {
					options.notes = component.notes;
				}

				builder.addComponent(component.component, options);
			}

			for (const configure of replicationConfigurators) {
				configure(builder);
			}

			return builder;
		},
		pipelineRegistrations,
		replicationComponents,
		resolved,
		state,
	};
}
