import type { PipelineRegistration } from "../pipeline";
import { createPipeline } from "../pipeline";
import type { ReplicationCodecRegistration, ReplicationCodecRegistry } from "../network/registry";

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
	const replicationComponents = new Array<ReplicationCodecRegistration>();
	const stateSlices = new Array<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>();

	for (const pkg of resolved.order) {
		for (const registration of pkg.pipeline ?? []) {
			pipelineRegistrations.push(registration);
		}

		for (const registration of pkg.replication?.templates ?? []) {
			pipelineRegistrations.push(registration as PipelineRegistration<TSystem>);
		}

		for (const codec of pkg.replication?.codecs ?? []) {
			replicationComponents.push(codec);
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
		installCodecs(r: ReplicationCodecRegistry) {
			for (const codecRegistration of replicationComponents) {
				r.register(codecRegistration);
			}
		},
		pipelineRegistrations,
		replicationComponents,
		resolved,
		state,
	};
}
