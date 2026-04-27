import {
	defineTemplateFamily,
	type SystemTemplate,
	type TemplateFamily,
	type TemplateSystem,
} from "./pipeline";
import { createDefaultReplicationPreset, type ReplicationSystemResolvers } from "./replication";

type RuntimeScope = "client" | "server" | "shared";

export type MatterTemplateFamilyName = "networking" | "player" | "documents" | "items" | "sound" | "tooling";

export interface FeatureSystemDescriptor<TKey extends string = string> {
	key: TKey;
	scope: RuntimeScope;
}

export interface FeatureSystemResolvers<TSystem = unknown, TKey extends string = string> {
	client?: Partial<Record<TKey, TSystem>>;
	server?: Partial<Record<TKey, TSystem>>;
	shared?: Partial<Record<TKey, TSystem>>;
}

export interface PlaceholderSystemContract {
	familyName?: MatterTemplateFamilyName;
	key: string;
	scope: RuntimeScope;
	templateName: string;
}

export type PlaceholderSystemFactory<TSystem> = (contract: PlaceholderSystemContract) => TSystem;

export interface BuildTemplateOptions<TSystem> {
	familyName?: MatterTemplateFamilyName;
	placeholderSystemFactory?: PlaceholderSystemFactory<TSystem>;
	dependenciesByScope?: Partial<Record<RuntimeScope, ReadonlyArray<string>>>;
	providesByScope?: Partial<Record<RuntimeScope, ReadonlyArray<string>>>;
}

function defaultPlaceholderSystem<TSystem>(contract: PlaceholderSystemContract): TSystem {
	return ((..._args: Array<unknown>) => {
		error(
			`[matter/templates] TODO: unresolved system '${contract.key}' in template '${contract.templateName}' (${contract.scope})` +
				`${contract.familyName ? ` for family '${contract.familyName}'` : ""}. Provide it via feature resolvers or family registration resolvers.`,
		);
	}) as unknown as TSystem;
}

function buildScopedTemplates<TSystem, TKey extends string>(
	featureName: string,
	descriptors: ReadonlyArray<FeatureSystemDescriptor<TKey>>,
	resolvers: FeatureSystemResolvers<TSystem, TKey>,
	options: BuildTemplateOptions<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	const byScope: Partial<Record<RuntimeScope, Array<TemplateSystem<TSystem>>>> = {};
	const placeholderSystemFactory = options.placeholderSystemFactory ?? defaultPlaceholderSystem<TSystem>;

	const scopeSuffix = (scope: RuntimeScope): string => {
		switch (scope) {
			case "shared":
				return "Shared";
			case "server":
				return "Server";
			case "client":
				return "Client";
		}
	};

	const createPlaceholderContract = (
		descriptor: FeatureSystemDescriptor<TKey>,
		templateName: string,
	): PlaceholderSystemContract => {
		const contract: PlaceholderSystemContract = {
			key: descriptor.key,
			scope: descriptor.scope,
			templateName,
		};

		if (options.familyName !== undefined) {
			contract.familyName = options.familyName;
		}

		return contract;
	};

	for (const descriptor of descriptors) {
		const templateName = `${featureName}${scopeSuffix(descriptor.scope)}`;
		const list = byScope[descriptor.scope] ?? [];
		list.push({
			key: descriptor.key,
			system:
				resolvers[descriptor.scope]?.[descriptor.key] ??
				placeholderSystemFactory(createPlaceholderContract(descriptor, templateName)),
		});
		byScope[descriptor.scope] = list;
	}

	const templates = new Array<SystemTemplate<TSystem>>();

	const toTemplate = (scope: RuntimeScope): void => {
		const systems = byScope[scope];
		if (!systems || systems.size() === 0) {
			return;
		}

		const template: SystemTemplate<TSystem> = {
			name: `${featureName}${scopeSuffix(scope)}`,
			systems,
		};

		const dependencies = options.dependenciesByScope?.[scope];
		if (dependencies !== undefined) {
			template.dependencies = dependencies;
		}

		const provides = options.providesByScope?.[scope];
		if (provides !== undefined) {
			template.provides = provides;
		}

		templates.push(template);
	};

	toTemplate("shared");
	toTemplate("server");
	toTemplate("client");

	return templates;
}

export const itemFeatureSystems: ReadonlyArray<FeatureSystemDescriptor> = [
	{ key: "serverItemHotbarManager", scope: "server" },
	{ key: "serverItemManager", scope: "server" },
	{ key: "serverItemSpawner", scope: "server" },
	{ key: "serverItemToolManager", scope: "server" },
	{ key: "clientItemHotbarSynchronizer", scope: "client" },
	{ key: "clientItemManager", scope: "client" },
	{ key: "clientItemToolManager", scope: "client" },
] as const;

export const networkFeatureSystems: ReadonlyArray<FeatureSystemDescriptor> = [
	{ key: "serverNetworkItemsSerializer", scope: "server" },
	{ key: "serverNetworkNotificationManager", scope: "server" },
	{ key: "clientNetworkClientStreamer", scope: "client" },
	{ key: "clientNetworkComponentSynchronizer", scope: "client" },
	{ key: "clientNetworkItemsDeserializer", scope: "client" },
	{ key: "clientNetworkNotificationManager", scope: "client" },
] as const;

export const soundFeatureSystems: ReadonlyArray<FeatureSystemDescriptor> = [
	{ key: "sharedSoundManager", scope: "shared" },
	{ key: "serverSoundManager", scope: "server" },
	{ key: "clientSoundManager", scope: "client" },
	{ key: "clientSoundEventPlayer", scope: "client" },
	{ key: "clientSoundRenderer", scope: "client" },
] as const;

export const worldFeatureSystems: ReadonlyArray<FeatureSystemDescriptor> = [
	{ key: "sharedWorldNodeManager", scope: "shared" },
	{ key: "serverWorldAssetIdAssigner", scope: "server" },
	{ key: "serverWorldNodeManager", scope: "server" },
	{ key: "clientWorldAssetPreloader", scope: "client" },
] as const;

export const playerFeatureSystems: ReadonlyArray<FeatureSystemDescriptor> = [
	{ key: "serverPlayerManager", scope: "server" },
	{ key: "serverDocumentManager", scope: "server" },
] as const;

const networkingFamilySystems = [
	...networkFeatureSystems,
	{ key: "serverReplicationManager", scope: "server" },
	{ key: "clientReplicationManager", scope: "client" },
] as const;

const playerFamilySystems = [
	{ key: "serverPlayerManager", scope: "server" },
	{ key: "serverProfileReplicator", scope: "server" },
	{ key: "clientProfileReplicator", scope: "client" },
] as const;

const documentFamilySystems = [{ key: "serverDocumentManager", scope: "server" }] as const;

const itemsFamilyRuntimeSystems = [
	{ key: "serverItemManager", scope: "server" },
	{ key: "serverItemSpawner", scope: "server" },
	{ key: "clientItemManager", scope: "client" },
] as const;

const itemsFamilyReplicationSystems = [
	{ key: "serverItemsReplicator", scope: "server" },
	{ key: "clientItemsReplicator", scope: "client" },
] as const;

const soundFamilyRuntimeSystems = [...soundFeatureSystems] as const;

const soundFamilyReplicationSystems = [
	{ key: "serverSoundReplicator", scope: "server" },
	{ key: "clientSoundReplicator", scope: "client" },
] as const;

const toolingFamilyRuntimeSystems = [
	{ key: "serverItemHotbarManager", scope: "server" },
	{ key: "serverItemToolManager", scope: "server" },
	{ key: "clientItemHotbarSynchronizer", scope: "client" },
	{ key: "clientItemToolManager", scope: "client" },
] as const;

const toolingFamilyReplicationSystems = [
	{ key: "serverInventoryReplicator", scope: "server" },
	{ key: "clientInventoryReplicator", scope: "client" },
	{ key: "serverHotbarReplicator", scope: "server" },
	{ key: "clientHotbarReplicator", scope: "client" },
] as const;

type DescriptorKey<TDescriptors extends ReadonlyArray<FeatureSystemDescriptor>> = TDescriptors[number]["key"];

type NetworkingFamilySystemKey = DescriptorKey<typeof networkingFamilySystems>;
type PlayerFamilySystemKey = DescriptorKey<typeof playerFamilySystems>;
type DocumentsFamilySystemKey = DescriptorKey<typeof documentFamilySystems>;
type ItemsFamilySystemKey =
	| DescriptorKey<typeof itemsFamilyRuntimeSystems>
	| DescriptorKey<typeof itemsFamilyReplicationSystems>;
type SoundFamilySystemKey =
	| DescriptorKey<typeof soundFamilyRuntimeSystems>
	| DescriptorKey<typeof soundFamilyReplicationSystems>;
type ToolingFamilySystemKey =
	| DescriptorKey<typeof toolingFamilyRuntimeSystems>
	| DescriptorKey<typeof toolingFamilyReplicationSystems>;

export type MatterTemplateSystemKey =
	| NetworkingFamilySystemKey
	| PlayerFamilySystemKey
	| DocumentsFamilySystemKey
	| ItemsFamilySystemKey
	| SoundFamilySystemKey
	| ToolingFamilySystemKey;

export interface MatterTemplateResolvers<TSystem = unknown>
	extends FeatureSystemResolvers<TSystem, MatterTemplateSystemKey> {}

export interface MatterTemplateFamilyOptions<TSystem = unknown> {
	placeholderSystemFactory?: PlaceholderSystemFactory<TSystem>;
}

export function createMatterTemplateFamilies<TSystem = unknown>(
	resolvers: MatterTemplateResolvers<TSystem> = {},
	options: MatterTemplateFamilyOptions<TSystem> = {},
): Array<TemplateFamily<MatterTemplateFamilyName, TSystem>> {
	const makeOptions = (familyName: MatterTemplateFamilyName): BuildTemplateOptions<TSystem> => {
		const nextOptions: BuildTemplateOptions<TSystem> = { familyName };
		if (options.placeholderSystemFactory !== undefined) {
			nextOptions.placeholderSystemFactory = options.placeholderSystemFactory;
		}

		return nextOptions;
	};

	return [
		defineTemplateFamily("networking", [
			...buildScopedTemplates("networkingRuntime", networkingFamilySystems, resolvers, makeOptions("networking")),
		]),
		defineTemplateFamily("player", [
			...buildScopedTemplates("playerRuntime", playerFamilySystems, resolvers, makeOptions("player")),
		]),
		defineTemplateFamily("documents", [
			...buildScopedTemplates("documentsRuntime", documentFamilySystems, resolvers, makeOptions("documents")),
		]),
		defineTemplateFamily("items", [
			...buildScopedTemplates("itemsRuntime", itemsFamilyRuntimeSystems, resolvers, makeOptions("items")),
			...buildScopedTemplates("itemsReplication", itemsFamilyReplicationSystems, resolvers, makeOptions("items")),
		]),
		defineTemplateFamily("sound", [
			...buildScopedTemplates("soundRuntime", soundFamilyRuntimeSystems, resolvers, makeOptions("sound")),
			...buildScopedTemplates("soundReplication", soundFamilyReplicationSystems, resolvers, makeOptions("sound")),
		]),
		defineTemplateFamily("tooling", [
			...buildScopedTemplates("toolingRuntime", toolingFamilyRuntimeSystems, resolvers, makeOptions("tooling")),
			...buildScopedTemplates("toolingReplication", toolingFamilyReplicationSystems, resolvers, makeOptions("tooling")),
		]),
	];
}

export function useItemFeature<TSystem = unknown>(
	resolvers: FeatureSystemResolvers<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	return buildScopedTemplates("itemFeature", itemFeatureSystems, resolvers);
}

export function useNetworkFeature<TSystem = unknown>(
	resolvers: FeatureSystemResolvers<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	return buildScopedTemplates("networkFeature", networkFeatureSystems, resolvers);
}

export function useSoundFeature<TSystem = unknown>(
	resolvers: FeatureSystemResolvers<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	return buildScopedTemplates("soundFeature", soundFeatureSystems, resolvers);
}

export function useWorldFeature<TSystem = unknown>(
	resolvers: FeatureSystemResolvers<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	return buildScopedTemplates("worldFeature", worldFeatureSystems, resolvers);
}

export function usePlayerInitFeature<TSystem = unknown>(
	resolvers: FeatureSystemResolvers<TSystem> = {},
): Array<SystemTemplate<TSystem>> {
	return buildScopedTemplates("playerInitFeature", playerFeatureSystems, resolvers);
}

export function useReplicationFeature<TSystem = unknown>(
	resolvers: ReplicationSystemResolvers<TSystem> = {},
): ReturnType<typeof createDefaultReplicationPreset<TSystem>> {
	return createDefaultReplicationPreset(resolvers);
}
