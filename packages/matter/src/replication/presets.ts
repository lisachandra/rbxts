import type { SystemTemplate } from "../pipeline";

import { createReplicationBuilder } from "./createReplicationBuilder";

export interface ReplicationSystemResolvers<TSystem = unknown> {
	client?: Partial<Record<string, TSystem>>;
	server?: Partial<Record<string, TSystem>>;
	shared?: Partial<Record<string, TSystem>>;
}

/**
 * Prebuilt replication preset aligned with current extraction scope.
 * Excludes combat/character/input/cauldron/npc-specific replication slices.
 */
export function createDefaultReplicationPreset<TSystem = unknown>(
	resolvers: ReplicationSystemResolvers<TSystem> = {},
): {
	components: Array<{ component: string; mode?: "all" | "owner" | "spectator"; notes?: string }>;
	templates: Array<SystemTemplate<TSystem>>;
} {
	const builder = createReplicationBuilder<TSystem>();

	builder.addComponent("Profile");
	builder.addSystem("server", "Profile", "profileReplicator", resolvers.server?.["profileReplicator"] as TSystem);
	builder.addSystem("client", "Profile", "profileReplicator", resolvers.client?.["profileReplicator"] as TSystem);

	builder.addComponent("Items");
	builder.addSystem("server", "Items", "itemsReplicator", resolvers.server?.["itemsReplicator"] as TSystem);
	builder.addSystem("client", "Items", "itemsReplicator", resolvers.client?.["itemsReplicator"] as TSystem);

	builder.addComponent("Inventory");
	builder.addSystem(
		"server",
		"Inventory",
		"inventoryReplicator",
		resolvers.server?.["inventoryReplicator"] as TSystem,
	);
	builder.addSystem(
		"client",
		"Inventory",
		"inventoryReplicator",
		resolvers.client?.["inventoryReplicator"] as TSystem,
	);

	builder.addComponent("Hotbar");
	builder.addSystem("server", "Hotbar", "hotbarReplicator", resolvers.server?.["hotbarReplicator"] as TSystem);
	builder.addSystem("client", "Hotbar", "hotbarReplicator", resolvers.client?.["hotbarReplicator"] as TSystem);

	builder.addComponent("Node");
	builder.addSystem("server", "Node", "nodeReplicator", resolvers.server?.["nodeReplicator"] as TSystem);
	builder.addSystem("client", "Node", "nodeReplicator", resolvers.client?.["nodeReplicator"] as TSystem);

	builder.addComponent("Sound");
	builder.addSystem("server", "Sound", "soundReplicator", resolvers.server?.["soundReplicator"] as TSystem);
	builder.addSystem("client", "Sound", "soundReplicator", resolvers.client?.["soundReplicator"] as TSystem);

	builder.addComponent("Stream");
	builder.addSystem("server", "Stream", "streamReplicator", resolvers.server?.["streamReplicator"] as TSystem);
	builder.addSystem("client", "Stream", "streamReplicator", resolvers.client?.["streamReplicator"] as TSystem);

	builder
		.addSystem(
			"server",
			"ReplicationManager",
			"serverReplicationManager",
			resolvers.server?.["serverReplicationManager"] as TSystem,
		)
		.addSystem(
			"client",
			"ReplicationManager",
			"clientReplicationManager",
			resolvers.client?.["clientReplicationManager"] as TSystem,
		);

	return {
		components: builder.getComponents(),
		templates: builder.buildTemplates("replication"),
	};
}
