import { Constant } from "@lisachandra/constant";
import type { ServerState } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import { catcher } from "@lisachandra/core/utils/main";
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
import { Janitor } from "@rbxts/janitor";
import type { Collection } from "@rbxts/lapis";
import Log from "@rbxts/log";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { useEvent } from "@rbxts/matter";
import { Players } from "@rbxts/services";

import { Components } from "../../../components";
import { useChange } from "../../../hooks";
import { useDocument } from "../../../hooks/useDocument";
import { Message, messaging } from "../../../network";
import { getDocumentConfig, getPlayerLifecycleHooks } from "../../../start";

const loadingQueue = new Map<Player, boolean>();
const eventQueue: Array<Callback> = [];

type PreSpawnResult = boolean | readonly [boolean, string?];

function normalizePreSpawnResult(result: PreSpawnResult): [boolean, string?] {
	if (typeIs(result, "boolean")) {
		return [result, undefined];
	}

	return [result[0], result[1]];
}

let internalDebugging = false;

function debugPrint(message: string): void {
	if (internalDebugging) {
		print(message);
	}
}

const c = new Constant().add("LOAD_TIMEOUT", 60).build();

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
		debugPrint(`[playerManager] waitForPlayerLoaded start ${player.Name}`);
		let disconnected = false;
		let settled = false;
		let disconnect: Callback = () => {};

		function finalize(callback: Callback): void {
			if (settled) {
				return;
			}

			settled = true;
			disconnect();
			callback();
		}

		function listener(loadedPlayer: Player): void {
			if (loadedPlayer !== player || loadingQueue.get(player) === true) {
				if (loadedPlayer === player) {
					debugPrint(
						`[playerManager] duplicate/ignored loaded ${player.Name} queued=${tostring(loadingQueue.get(player))}`,
					);
				}

				return;
			}

			debugPrint(`[playerManager] loaded received ${player.Name}`);
			loadingQueue.set(player, true);
			task.spawn(() => {
				while (true) {
					if (disconnected || settled) {
						break;
					}

					const data = useDocument(collection, player.UserId, player);
					debugPrint(`[playerManager] polling document ${player.Name}`);
					if (data.document) {
						const { document } = data;
						debugPrint(`[playerManager] document ready ${player.Name}`);
						if (!document) {
							continue;
						}

						finalize(() => {
							resolve({
								...data,
								document,
							});
						});
						return;
					}

					task.wait(1);
				}
			});
		}

		let disconnectFn: Callback = () => {};

		disconnect = () => {
			if (disconnected) {
				return;
			}

			disconnected = true;
			loadingQueue.delete(player);
			disconnectFn();
		};

		disconnectFn = messaging.server.on(Message.Loaded, listener);
		debugPrint(`[playerManager] subscribed loaded ${player.Name}`);
		task.delay(c.LOAD_TIMEOUT, () => {
			finalize(() => {
				debugPrint(`[playerManager] load timeout ${player.Name}`);
				reject();
			});
		});
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
	Log.Info(`initializing player: ${player.Name}`);
	debugPrint(`[playerManager] defaultPlayerAdded start ${player.Name}`);

	const hooks = getPlayerLifecycleHooks();
	const documentConfig = getDocumentConfig();
	const collection = documentConfig?.collection;

	debugPrint(`[playerManager] queued sync ${player.Name}`);

	syncWithEventQueue()
		.then(async () => {
			debugPrint(`[playerManager] sync resumed ${player.Name}`);
			// preSpawn — validate before spawning
			if (hooks?.preSpawn) {
				let result: PreSpawnResult;
				try {
					result = await Promise.resolve(hooks.preSpawn(player));
				} catch (err) {
					Log.Warn(
						`[playerManager] preSpawn failed for ${player.Name}: ${tostring(err)}`,
					);
					if (player.Parent === Players) {
						player.Kick("Unable to verify access right now. Please rejoin.");
					}

					return;
				}

				const [allowed, message] = normalizePreSpawnResult(result);
				if (!allowed) {
					if (player.Parent === Players) {
						player.Kick(message ?? "Access denied");
					}

					return;
				}
			}

			if (player.Parent !== Players) {
				return;
			}

			const entityId = world.spawn();
			player.SetAttribute("serverEntityId", entityId);
			debugPrint(`[playerManager] spawned server entity ${player.Name} ${entityId}`);

			let playerJanitor: Janitor;

			if (collection !== undefined) {
				debugPrint(`[playerManager] awaiting loaded ${player.Name}`);
				const [status, data] = waitForPlayerLoaded(player, collection).await();
				if (!status) {
					debugPrint(`[playerManager] await failed ${player.Name}`);
					player.Kick("Load timeout, please rejoin and try again!");
					return;
				}

				Log.Info(`spawning player: ${player.Name}`);
				debugPrint(`[playerManager] document-backed spawn ${player.Name}`);

				playerJanitor = new Janitor();
				playerJanitor.Add(async () => {
					data.document.close().await();
				});
			} else {
				Log.Info(`spawning player (no document): ${player.Name}`);
				debugPrint(`[playerManager] no-document spawn ${player.Name}`);
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

			debugPrint(
				`[playerManager] inserting components ${player.Name} count=${components.size()}`,
			);

			world.insert(entityId, ...components);
			debugPrint(`[playerManager] inserted components ${player.Name} ${entityId}`);
			world.commitCommands();
			debugPrint(`[playerManager] committed components ${player.Name} ${entityId}`);
			player.SetAttribute("serverEntityId", entityId);
			debugPrint(`[playerManager] reassigned serverEntityId ${player.Name} ${entityId}`);

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
	Log.Info(`removing Player: ${player.Name}`);

	const entityId = player.GetAttribute<AnyEntity>("serverEntityId");
	if (entityId !== undefined && world.contains(entityId)) {
		world.get(entityId, Components.Profile)?.janitor.Destroy();
		world.despawn(entityId);
	}
}

function system(world: World, _crate: Crate<ServerState>, ui: DebugWidgets): void {
	internalDebugging = ui.checkbox("Trace player bootstrap").checked();
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
