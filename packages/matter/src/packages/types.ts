import type { Crate } from "@rbxts/crate";
import type { SystemStruct } from "@rbxts/matter";

import type { ReplicationCodecRegistration, ReplicationCodecRegistry } from "../network/registry";
import type { PipelineBuilder, PipelineRegistration, SystemTemplate } from "../pipeline";

type TSystem = SystemStruct<any>;

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
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	dependencies?: ReadonlyArray<TId>;
	id: TId;
	metadata?: MatterPackageMetadata;
	pipeline?: ReadonlyArray<PipelineRegistration>;
	replication?: MatterPackageReplication;
	state?: ReadonlyArray<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>;
}

export interface MatterPackageRegistry<
	TId extends string = string,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	discover(
		predicate?: (pkg: MatterPackageDescriptor<TId, TCrateState, TStateKey>) => boolean,
	): Array<MatterPackageDescriptor<TId, TCrateState, TStateKey>>;
	entries(): ReadonlyMap<TId, MatterPackageDescriptor<TId, TCrateState, TStateKey>>;
	get(id: TId): undefined | MatterPackageDescriptor<TId, TCrateState, TStateKey>;
	has(id: TId): boolean;
	register(
		pkg: MatterPackageDescriptor<TId, TCrateState, TStateKey>,
	): MatterPackageRegistry<TId, TCrateState, TStateKey>;
	registerMany(
		packages: ReadonlyArray<MatterPackageDescriptor<TId, TCrateState, TStateKey>>,
	): MatterPackageRegistry<TId, TCrateState, TStateKey>;
	resolve(requested: ReadonlyArray<TId>): ResolvedMatterPackageGraph<TId, TCrateState, TStateKey>;
}

export interface ResolvedMatterPackageGraph<
	TId extends string = string,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	index: ReadonlyMap<TId, MatterPackageDescriptor<TId, TCrateState, TStateKey>>;
	order: ReadonlyArray<MatterPackageDescriptor<TId, TCrateState, TStateKey>>;
	requested: ReadonlyArray<TId>;
}

export interface MatterPackageStateManager<
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	collect(crate: Crate<TCrateState>): Record<TStateKey, unknown>;
	entries(): ReadonlyArray<MatterPackageStateSlice<TCrateState, unknown, TStateKey>>;
}

export interface MatterPackageRuntime<
	TId extends string = string,
	TCrateState extends object = object,
	TStateKey extends string = string,
> {
	buildSystems(builder?: PipelineBuilder): Array<TSystem>;
	installCodecs(registry: ReplicationCodecRegistry): void;
	installPipeline(builder: PipelineBuilder): PipelineBuilder;
	pipelineRegistrations: ReadonlyArray<PipelineRegistration>;
	replicationComponents: ReadonlyArray<ReplicationCodecRegistration>;
	resolved: ResolvedMatterPackageGraph<TId, TCrateState, TStateKey>;
	state: MatterPackageStateManager<TCrateState, TStateKey>;
}
