import type { AnySystem } from "../start";
import type { MatterPackageDescriptor } from "../packages";
import { definePackage } from "../packages";

// Server systems
import { meta as serverPlayerManager } from "./server/player/playerManager";
import { meta as serverDocumentManager } from "./server/player/documentManager";
import { meta as serverItemManager } from "./server/item/itemManager";
import { meta as serverToolManager } from "./server/item/toolManager";
import { meta as serverHotbarManager } from "./server/item/hotbarManager";
import { meta as serverSoundManager } from "./server/sound/soundManager";
import { meta as serverReplicationManager } from "./server/network/replicationManager";

// Client systems
import { meta as clientReplicationManager } from "./client/network/replicationManager";
import { meta as clientStreamer } from "./client/network/clientStreamer";
import { meta as clientItemManager } from "./client/item/itemManager";
import { meta as clientToolManager } from "./client/item/toolManager";
import { meta as clientHotbarSynchronizer } from "./client/item/hotbarSynchronizer";
import { meta as clientSoundManager } from "./client/sound/soundManager";
import { meta as clientSoundRenderer } from "./client/sound/soundRenderer";

// Shared systems
import { meta as sharedSoundManager } from "./shared/sound/soundManager";
import { meta as sharedNodeManager } from "./shared/world/nodeManager";

/**
 * Single package descriptor containing all builtin @lisachandra/matter systems.
 *
 * @example
 * ```ts
 * import { builtinPackage } from "@lisachandra/matter/systems";
 * import { bootstrap } from "@lisachandra/platform";
 *
 * bootstrap({ packages: [builtinPackage] });
 * ```
 */
export const builtinPackage = definePackage({
	id: "builtin",
	metadata: {
		description: "Builtin @lisachandra/matter systems — players, items, replication, sound, and world nodes",
	},
	pipeline: [
		// ── Server: Player lifecycle ──
		{
			name: "builtin:player",
			kind: "template",
			systems: [
				{ key: "serverPlayerManager", system: serverPlayerManager },
				{ key: "serverDocumentManager", system: serverDocumentManager },
			],
		},

		// ── Server: Items ──
		{
			name: "builtin:items",
			kind: "template",
			dependencies: ["builtin:player"],
			systems: [
				{ key: "serverItemManager", system: serverItemManager },
				{ key: "serverToolManager", system: serverToolManager },
				{ key: "serverHotbarManager", system: serverHotbarManager },
			],
		},

		// ── Server: Replication (depends on items + hotbar being set up) ──
		{
			name: "builtin:replication",
			kind: "template",
			dependencies: ["builtin:items"],
			systems: [{ key: "serverReplicationManager", system: serverReplicationManager }],
		},

		// ── Client: Network ──
		{
			name: "builtin:network",
			kind: "template",
			dependencies: ["builtin:replication"],
			systems: [
				{ key: "clientReplicationManager", system: clientReplicationManager },
				{ key: "clientStreamer", system: clientStreamer },
			],
		},

		// ── Client: Items ──
		{
			name: "builtin:clientItems",
			kind: "template",
			dependencies: ["builtin:network", "builtin:items"],
			systems: [
				{ key: "clientItemManager", system: clientItemManager },
				{ key: "clientToolManager", system: clientToolManager },
				{ key: "clientHotbarSynchronizer", system: clientHotbarSynchronizer },
			],
		},

		// ── Sound (shared + server + client) ──
		{
			name: "builtin:sound",
			kind: "template",
			systems: [
				{ key: "sharedSoundManager", system: sharedSoundManager },
				{ key: "serverSoundManager", system: serverSoundManager },
				{ key: "clientSoundManager", system: clientSoundManager },
				{ key: "clientSoundRenderer", system: clientSoundRenderer },
			],
		},

		// ── World nodes (shared) ──
		{
			name: "builtin:world",
			kind: "template",
			systems: [{ key: "sharedNodeManager", system: sharedNodeManager }],
		},
	],
});
