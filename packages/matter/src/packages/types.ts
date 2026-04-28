import type { Crate } from "@rbxts/crate";

import type { PipelineBuilder, PipelineRegistration, SystemTemplate } from "../pipeline";
import type { ReplicationCodecRegistration, ReplicationCodecRegistry } from "../network/registry";

export interface MatterPackageMetadata {
	description?: string;
	tags?: ReadonlyArray<string>;
	version?: string;
}

export interface MatterPackageStateSlice<
	TCrateState extends object = object,
	TSlice = unknown,
	TKey extends string = string,
> {
	create: (crate: Crate<TCrateState>) => TSlice;
	key: TKey;
}

export interface MatterPackageReplication {
	codecs?: ReadonlyArray<ReplicationCodecRegistration>;
	templates?: ReadonlyArray<SystemTemplate>;
}

export interface MatterPackageDescriptor<
	TId extends string = string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	dependencies?: ReadonlyArray<TId>;
	id: TId;
	metadata?: MatterPackageMetadata;
	pipeline?: ReadonlyArray<PipelineRegistration<TSystem>>;
	replication?: MatterPackageReplication;
	state?: ReadonlyArray<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>;
}

export interface MatterPackageRegistry<
	TId extends string = string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	discover(predicate?: (pkg: MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>) => boolean): Array<
		MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>
	>;
	entries(): ReadonlyMap<TId, MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>;
	get(id: TId): MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey> | undefined;
	has(id: TId): boolean;
	register(
		pkg: MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>,
	): MatterPackageRegistry<TId, TSystem, TCrateState, TStateKey>;
	registerMany(
		packages: ReadonlyArray<MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>,
	): MatterPackageRegistry<TId, TSystem, TCrateState, TStateKey>;
	resolve(requested: ReadonlyArray<TId>): ResolvedMatterPackageGraph<TId, TSystem, TCrateState, TStateKey>;
}

export interface ResolvedMatterPackageGraph<
	TId extends string = string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	index: ReadonlyMap<TId, MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>;
	order: ReadonlyArray<MatterPackageDescriptor<TId, TSystem, TCrateState, TStateKey>>;
	requested: ReadonlyArray<TId>;
}

export interface MatterPackageStateManager<TCrateState extends object = object, TStateKey extends string = string> {
	collect(crate: Crate<TCrateState>): Record<TStateKey, unknown>;
	entries(): ReadonlyArray<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>;
}

export interface MatterPackageRuntime<
	TId extends string = string,
	TSystem = unknown,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	buildSystems(builder?: PipelineBuilder<TSystem>): Array<TSystem>;
	installPipeline(builder: PipelineBuilder<TSystem>): PipelineBuilder<TSystem>;
	installCodecs(registry: ReplicationCodecRegistry): void;
	pipelineRegistrations: ReadonlyArray<PipelineRegistration<TSystem>>;
	replicationComponents: ReadonlyArray<ReplicationCodecRegistration>;
	resolved: ResolvedMatterPackageGraph<TId, TSystem, TCrateState, TStateKey>;
	state: MatterPackageStateManager<TCrateState, TStateKey>;
}
