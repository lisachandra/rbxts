/*
 * This system manages player lifecycle events, such as joining and leaving the
 * game. It initializes player data, assigns attributes, and synchronizes player
 * state with the server. It ensures players are properly integrated into the
 * game world with their profiles and components.
 *
 * **Customization:**
 * Supply a `PlayerLifecycleHooks` via `configureRuntimeAdapters` to take
 * full control over player initialization/removal, or add behavior before
 * the default cleanup.
 *
 * - `onPlayerAdded` — **replaces** the default flow entirely.
 *   Your implementation owns spawning the entity, loading documents,
 *   inserting components, etc.
 *
 * - `onPlayerRemoving` — called **before** default cleanup (janitor destroy
 *   + entity despawn). Useful for saving game-specific state.
 */
import type { Crate } from "@rbxts/crate";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { useEvent } from "@rbxts/matter";
import { Players } from "@rbxts/services";
import { useChange } from "../../../hooks";
import { ServerState, store } from "@lisachandra/core/out/store";
import { Components } from "../../../components";
import { getPlayerLifecycleHooks } from "../../../start";
import { getDocumentConfig } from "../../../start";
import type { Collection } from "@rbxts/lapis";
import { Message, messaging } from "../../../network";
import Log from "@rbxts/log";
import { Janitor } from "@rbxts/janitor";
import { useDocument } from "../../../hooks/useDocument";
import { catcher } from "@lisachandra/core/out/utils/main";

const loadingQueue = new Map<Player, boolean>();
const eventQueue: Array<Callback> = [];
const loadTimeout = 60;

async function syncWithEventQueue(): Promise<void> {
	return new Promise<void>((resolve) => {
		eventQueue.push(resolve);
	});
}

/*
 * Waits for a player's loading process to complete and fetches their document
 * data.
 */
async function waitForPlayerLoaded(
	player: Player,
	collection: Collection<any, any>,
): Promise<Required<ReturnType<typeof useDocument>>> {
	return new Promise((resolve, reject) => {
		let disconnected = false;
		let disconnect: Callback = () => {};

		function listener(loadedPlayer: Player): void {
			if (loadedPlayer !== player || loadingQueue.get(player) === true) {
				return;
			}

			loadingQueue.set(player, true);

			while (!disconnected) {
				const data = useDocument(collection, player.UserId, player);
				if (data.document) {
					disconnect();
					resolve({
						...data,
						document: data.document,
					});
				}

				task.wait(1);
			}
		}

		let disconnectFn: Callback
		disconnect = () => {
			if (disconnected) {
				return;
			}

			disconnected = true;
			loadingQueue.delete(player);
			disconnectFn();
		};

		disconnectFn = messaging.server.on(Message.Loaded, listener)
		task.wait(loadTimeout);
		disconnect();
		reject();
	});
}

/*
 * Initializes a player with the default flow:
 *   1. Spawn an entity
 *   2. Wait for the player's "Loaded" message
 *   3. Create a Janitor and load the player's document
 *   4. Insert `[Profile, Inventory, Hotbar, Forces]`
 *   5. Emit `Message.Time` with server clock/epoch
 */
function defaultPlayerAdded(world: World, player: Player): void {
	Log.Info("initializing player:", player.Name);

	const hooks = getPlayerLifecycleHooks();
	const documentConfig = getDocumentConfig();
	const collection = documentConfig?.collection;

	syncWithEventQueue()
		.then(async () => {
			// preSpawn — validate before spawning
			if (hooks?.preSpawn) {
				const result = hooks.preSpawn(player);
				const [allowed, message] = typeIs(result, "boolean")
					? [result]
					: await Promise.resolve(result).catch(catcher) ?? [];
				if (!allowed) {
					player.Kick(message ?? "Access denied");
					return;
				}
			}

			const entityId = world.spawn();
			player.SetAttribute("serverEntityId", entityId);

			let playerJanitor: Janitor;

			if (collection !== undefined) {
				const [status, data] = waitForPlayerLoaded(player, collection).await();
				if (!status) {
					player.Kick("Load timeout, please rejoin and try again!");
					return;
				}

				Log.Info("spawning player:", player.Name);

				playerJanitor = new Janitor();
				playerJanitor.Add(async () => {
					data.document.close().await();
				});
			} else {
				Log.Info("spawning player (no document):", player.Name);
				playerJanitor = new Janitor();
			}

			// componentFactory — customizable component list
			const components = hooks?.componentFactory
				? hooks.componentFactory(player, playerJanitor)
				: [
					Components.Profile({ janitor: playerJanitor, player }),
					Components.Inventory(),
					Components.Hotbar(),
					Components.Forces(),
				];

			world.insert(entityId, ...components);
			world.commitCommands();
			player.SetAttribute("serverEntityId", entityId);

			messaging.client.emit(player, Message.Time, {
				startClock: store.server.getState("serverStartClock"),
				startEpoch: store.server.getState("serverStartEpoch"),
			});

			// postSpawn hook
			hooks?.postSpawn?.(world, player, entityId);
		})
		.catch(catcher);
}

/*
 * Handles default player cleanup: destroys the profile janitor and despawns
 * the entity.
 */
function defaultPlayerRemoving(world: World, player: Player): void {
	Log.Info("removing Player:", player.Name);

	const entityId = player.GetAttribute<AnyEntity>("serverEntityId");
	if (entityId !== undefined && world.contains(entityId)) {
		world.get(entityId, Components.Profile)?.janitor.Destroy();
		world.despawn(entityId);
	}
}

function system(world: World): void {
	for (const func of eventQueue) {
		func();
	}

	world.commitCommands();
	eventQueue.clear();

	const hooks = getPlayerLifecycleHooks();

	// Handle early players (joined before system execution)
	const early = new Set<Player>();
	if (useChange([])) {
		for (const player of Players.GetPlayers()) {
			early.add(player);
			if (hooks?.onPlayerAdded) {
				hooks.onPlayerAdded(world, player);
			} else {
				defaultPlayerAdded(world, player);
			}
		}
	}

	for (const [_, player] of useEvent(Players, "PlayerAdded")) {
		if (early.has(player)) {
			continue;
		}

		if (hooks?.onPlayerAdded) {
			hooks.onPlayerAdded(world, player);
		} else {
			defaultPlayerAdded(world, player);
		}
	}

	for (const [_, player] of useEvent(Players, "PlayerRemoving")) {
		hooks?.onPlayerRemoving?.(world, player);
		defaultPlayerRemoving(world, player);
	}
}

export const meta = {
	phase: "preSimulation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
