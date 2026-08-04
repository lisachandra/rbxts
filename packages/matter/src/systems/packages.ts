import { definePackage } from "../packages";
import { meta as clientHotbarSynchronizer } from "./client/item/hotbarSynchronizer";
import { meta as clientItemManager } from "./client/item/itemManager";
import { meta as clientToolManager } from "./client/item/toolManager";
import { meta as clientStreamer } from "./client/network/clientStreamer";
import { meta as clientEntityManager } from "./client/network/entityManager";
import { meta as clientHookConnectorManager } from "./client/network/hookConnectorManager";
// Client systems
import { meta as clientReplicationManager } from "./client/network/replicationManager";
import { meta as clientSoundManager } from "./client/sound/soundManager";
import { meta as clientSoundRenderer } from "./client/sound/soundRenderer";
import { meta as serverHotbarManager } from "./server/item/hotbarManager";
import { meta as serverItemManager } from "./server/item/itemManager";
import { meta as serverToolManager } from "./server/item/toolManager";
import { meta as serverReplicationManager } from "./server/network/replicationManager";
// Server systems
import { meta as serverPlayerManager } from "./server/player/playerManager";
import { meta as serverSoundManager } from "./server/sound/soundManager";
// Shared systems
import { meta as sharedSoundManager } from "./shared/sound/soundManager";
import { meta as sharedNodeManager } from "./shared/world/nodeManager";

/**
 * Single package descriptor containing all builtin @lisachandra/matter systems.
 *
 * @example
 * 	```ts
 * 	import { builtinPackage } from "@lisachandra/matter/systems";
 * 	import { bootstrap } from "@lisachandra/platform";
 *
 * 	bootstrap({ packages: [builtinPackage] });
 * 	```;
 */
export const builtinPackage = definePackage({
	id: "builtin",
	metadata: {
		description:
			"Builtin @lisachandra/matter systems — players, items, replication, sound, and world nodes",
	},
	pipeline: [
		// ── Server: Player lifecycle ──
		{
			kind: "template",
			name: "builtin:player",
			systems: [
				{ key: "serverPlayerManager", runtime: "server", system: serverPlayerManager },
			],
		},

		// ── Server: Items ──
		{
			dependencies: ["builtin:player"],
			kind: "template",
			name: "builtin:items",
			systems: [
				{ key: "serverItemManager", runtime: "server", system: serverItemManager },
				{ key: "serverToolManager", runtime: "server", system: serverToolManager },
				{ key: "serverHotbarManager", runtime: "server", system: serverHotbarManager },
			],
		},

		// ── Server: Replication (depends on items + hotbar being set up) ──
		{
			dependencies: ["builtin:items"],
			kind: "template",
			name: "builtin:replication",
			systems: [
				{
					key: "serverReplicationManager",
					runtime: "server",
					system: serverReplicationManager,
				},
			],
		},

		// ── Client: Network ──
		{
			dependencies: ["builtin:replication"],
			kind: "template",
			name: "builtin:network",
			systems: [
				{
					key: "clientReplicationManager",
					runtime: "client",
					system: clientReplicationManager,
				},
				{ key: "clientEntityManager", runtime: "client", system: clientEntityManager },
				{ key: "clientStreamer", runtime: "client", system: clientStreamer },
				{
					key: "clientHookConnectorManager",
					runtime: "client",
					system: clientHookConnectorManager,
				},
			],
		},

		// ── Client: Items ──
		{
			dependencies: ["builtin:network", "builtin:items"],
			kind: "template",
			name: "builtin:clientItems",
			systems: [
				{ key: "clientItemManager", runtime: "client", system: clientItemManager },
				{ key: "clientToolManager", runtime: "client", system: clientToolManager },
				{
					key: "clientHotbarSynchronizer",
					runtime: "client",
					system: clientHotbarSynchronizer,
				},
			],
		},

		// ── Sound (shared + server + client) ──
		{
			kind: "template",
			name: "builtin:sound",
			systems: [
				{ key: "sharedSoundManager", runtime: "shared", system: sharedSoundManager },
				{ key: "serverSoundManager", runtime: "server", system: serverSoundManager },
				{ key: "clientSoundManager", runtime: "client", system: clientSoundManager },
				{ key: "clientSoundRenderer", runtime: "client", system: clientSoundRenderer },
			],
		},

		// ── World nodes (shared) ──
		{
			kind: "template",
			name: "builtin:world",
			systems: [{ key: "sharedNodeManager", runtime: "shared", system: sharedNodeManager }],
		},
	],
});
