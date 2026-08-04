import type { ClientState, ServerState } from "@lisachandra/core/store";
import { store } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { Janitor } from "@rbxts/janitor";
import type { Collection } from "@rbxts/lapis";
import { String } from "@rbxts/luau-polyfill";
import type { AnyEntity, Component, System } from "@rbxts/matter";
import { Debugger, Loop, World } from "@rbxts/matter";
import Plasma from "@rbxts/plasma";
import type { Context } from "@rbxts/rewire";
import { HotReloader } from "@rbxts/rewire";
import { RunService } from "@rbxts/services";

import { getEntityInstanceComponent } from "./entityLookup";
import { customPhases, renderPriorityPhaseEvents } from "./phases";
import { getComponentObject } from "./utils/entity";

const HOT_RELOAD_EXCLUDED_NAME_SUFFIXES = [
	".story",
	".storybook",
	".stories",
	".test",
	".spec",
] as const;

export type AnySystem = System<Array<unknown>>;
export interface SystemContainer {
	event?: string;
	phase?: string;
	placeIds?: Array<number>;
}
export type SystemEvent = NonNullable<SystemContainer["event"]>;
export type SystemModule = Record<string, unknown> & { meta: SystemContainer };

export interface DocumentConfig {
	/**
	 * The Lapis collection instance for document persistence. Create one with `createCollection()`
	 * from `@rbxts/lapis`.
	 */
	collection: Collection<any, any>;
	/**
	 * Map of component names → document keys for change-triggered persistence.
	 *
	 * Default: `{ Hotbar: "hotbar", Inventory: "inventory" }`.
	 */
	persistedComponents?: Record<string, string>;
}

export interface PlayerLifecycleHooks {
	/**
	 * Validate before spawn. Return `false` (or `[false, message]`) to kick the player with the
	 * supplied message. A rejected Promise indicates that access could not be verified and is
	 * handled as an operational failure.
	 *
	 * @param player - The Player who is joining.
	 */
	preSpawn?: (
		player: Player,
	) => boolean | readonly [boolean, string?] | Promise<boolean | readonly [boolean, string?]>;

	/**
	 * Customize which components are inserted into the player entity. Called AFTER the entity is
	 * spawned and document is loaded.
	 *
	 * Default components:.
	 *
	 * ```ts
	 * [Profile({ janitor, player }), Inventory(), Hotbar(), Forces()];
	 * ```
	 *
	 * @param player - The Player who joined.
	 * @param janitor - A Janitor scoped to this player's lifecycle.
	 */
	componentFactory?: (player: Player, janitor: Janitor) => Array<Component<object>>;

	/**
	 * Called AFTER spawn, component insertion, and `Message.Time` emit.
	 *
	 * @param world - The Matter world.
	 * @param player - The Player who joined.
	 * @param entityId - The newly spawned entity's ID.
	 */
	postSpawn?: (world: World, player: Player, entityId: AnyEntity) => void;

	/**
	 * Custom player initialization.
	 *
	 * If provided, this **completely replaces** the default `playerAdded` logic (spawn entity, load
	 * document, insert components). Your implementation owns the full lifecycle — spawn the entity,
	 * load documents, insert components, emit timing messages, etc.
	 *
	 * If not provided, the default behavior runs:
	 *
	 * 1. Call `preSpawn` (kick if returns false)
	 * 2. Spawn an entity
	 * 3. Wait for the player's "Loaded" message
	 * 4. Create a Janitor and load the player's document
	 * 5. Insert components via `componentFactory` (or defaults)
	 * 6. Emit `Message.Time` with server clock/epoch
	 * 7. Call `postSpawn`.
	 *
	 * @param world - The Matter world.
	 * @param player - The Player who joined.
	 */
	onPlayerAdded?: (world: World, player: Player) => void;

	/**
	 * Custom player removal.
	 *
	 * If provided, called **before** the default cleanup (janitor destroy + entity despawn). Useful
	 * for saving game-specific state.
	 *
	 * If not provided, only the default cleanup runs.
	 *
	 * @param world - The Matter world.
	 * @param player - The Player who left.
	 */
	onPlayerRemoving?: (world: World, player: Player) => void;
}

export interface InputAdapter {
	/** Returns which keycodes are currently held down. */
	getHeldKeys(): Array<Enum.KeyCode>;
	/** Fires when a key is pressed. */
	onKeyPressed(callback: (key: Enum.KeyCode) => void): () => void;
}

export interface RuntimeAdapters {
	authorize?: (player: Player) => Promise<boolean>;
	document?: DocumentConfig;
	findInstanceFromEntity?: (entityId: AnyEntity) => N<Instance>;
	hotbarInputAdapter?: InputAdapter;
	playerLifecycle?: PlayerLifecycleHooks;
}

const runtimeAdapters = {
	authorize: async () => true,
	findInstanceFromEntity: (_entityId) => undefined,
} satisfies RuntimeAdapters as RuntimeAdapters;

export function configureRuntimeAdapters(adapters: RuntimeAdapters): void {
	if (adapters.authorize) {
		runtimeAdapters.authorize = adapters.authorize;
	}

	if (adapters.findInstanceFromEntity) {
		runtimeAdapters.findInstanceFromEntity = adapters.findInstanceFromEntity;
	}

	if (adapters.playerLifecycle) {
		runtimeAdapters.playerLifecycle = adapters.playerLifecycle;
	}

	if (adapters.hotbarInputAdapter) {
		runtimeAdapters.hotbarInputAdapter = adapters.hotbarInputAdapter;
	}

	if (adapters.document) {
		runtimeAdapters.document = adapters.document;
	}
}

/**
 * Returns the configured hotbar input adapter, if any. If no adapter was configured, the system
 * falls back to detecting `Enum.KeyCode` presses directly via `UserInputService`.
 */
export function getHotbarInputAdapter(): N<InputAdapter> {
	return runtimeAdapters.hotbarInputAdapter;
}

/** Returns the configured player lifecycle hooks, if any. */
export function getPlayerLifecycleHooks(): N<PlayerLifecycleHooks> {
	return runtimeAdapters.playerLifecycle;
}

/** Returns the configured document config, if any. */
export function getDocumentConfig(): N<DocumentConfig> {
	return runtimeAdapters.document;
}

export function findInstanceFromEntity(entityId: AnyEntity): N<Instance> {
	if (runtimeAdapters.findInstanceFromEntity) {
		return runtimeAdapters.findInstanceFromEntity(entityId);
	}

	return getComponentObject(getEntityInstanceComponent(store.world, entityId));
}

export async function isAuthorized(player: Player): Promise<boolean> {
	if (runtimeAdapters.authorize) {
		return runtimeAdapters.authorize(player);
	}

	// Maintainability-first fallback: package runtime does not hardcode game-level policy.
	return player.UserId > 0;
}

export function findSystems(barrel: object, systems: Array<AnySystem> = []): Array<AnySystem> {
	for (const [, container] of pairs(barrel)) {
		if (!typeIs(container, "table")) {
			continue;
		}

		const typedContainer = container as SystemModule;
		const system = "meta" in typedContainer ? typedContainer.meta : undefined;

		if (!system) {
			findSystems(container, systems);
			continue;
		}

		if (!(system.placeIds ?? [game.PlaceId]).includes(game.PlaceId)) {
			continue;
		}

		systems.push(toRuntimeSystem(system));
	}

	return systems;
}

function shouldHotReloadModule(module: ModuleScript): boolean {
	if (String.includes(module.GetFullName(), ".__tests__.")) {
		return false;
	}

	for (const suffix of HOT_RELOAD_EXCLUDED_NAME_SUFFIXES) {
		if (module.Name.sub(-suffix.size()) === suffix) {
			return false;
		}
	}

	return true;
}

function toRuntimeSystem(system: SystemContainer): AnySystem {
	if (system.phase !== undefined) {
		system.event = system.phase;
	}

	return system as never;
}

function getHotReloadSystem(module: ModuleScript): N<AnySystem> {
	const [success, result] = pcall(require, module) as LuaTuple<[boolean, unknown]>;

	if (!success) {
		throw `Failed to hot-reload system module ${module.GetFullName()}: ${tostring(result)}`;
	}

	if (!typeIs(result, "table")) {
		return undefined;
	}

	const system = (result as SystemModule).meta;
	if (system === undefined) {
		return undefined;
	}

	if (!(system.placeIds ?? [game.PlaceId]).includes(game.PlaceId)) {
		return undefined;
	}

	return toRuntimeSystem(system);
}

export interface StartOptions {
	containers?: Array<Instance>;
	systems?: Array<AnySystem>;
}

export function start(options: StartOptions = {}): {
	crate: Crate<ClientState | ServerState>;
	debugger: InstanceType<typeof Debugger>;
	loop: Loop<any>;
	world: World;
} {
	const world = new World();
	const worldDebugger = new Debugger(Plasma);
	const loop = new Loop(world, store.shared, worldDebugger.getWidgets());

	worldDebugger.loopParameterNames = ["World", "Crate", "Widgets"];
	worldDebugger.findInstanceFromEntity = (entityId) =>
		runtimeAdapters.findInstanceFromEntity!(entityId);
	worldDebugger.authorize = (player) => runtimeAdapters.authorize!(player).expect();

	const hotReloadSystems = new Array<AnySystem>();
	const staticSystems = options.systems ?? [];
	const systemsByModule = new Map<ModuleScript, AnySystem>();
	let isBootstrappingHotReload = false;

	if (
		RunService.IsStudio() &&
		options.containers !== undefined &&
		options.containers.size() > 0
	) {
		const hotReloader = new HotReloader();
		isBootstrappingHotReload = true;

		const loadModule = (module: ModuleScript, context: Context): void => {
			if (!shouldHotReloadModule(module)) {
				return;
			}

			const system = getHotReloadSystem(module);
			if (system === undefined) {
				return;
			}

			const previousSystem = systemsByModule.get(context.originalModule);
			if (previousSystem !== undefined) {
				loop.replaceSystem(previousSystem, system);
				worldDebugger.replaceSystem(previousSystem, system);
			} else if (isBootstrappingHotReload) {
				hotReloadSystems.push(system);
			} else {
				loop.scheduleSystem(system);
			}

			systemsByModule.set(context.originalModule, system);
		};

		const unloadModule = (_module: ModuleScript, context: Context): void => {
			if (context.isReloading) {
				return;
			}

			const scheduledSystem = systemsByModule.get(context.originalModule);
			if (scheduledSystem === undefined) {
				return;
			}

			loop.evictSystem(scheduledSystem);
			systemsByModule.delete(context.originalModule);
		};

		for (const container of options.containers) {
			hotReloader.scan(container, loadModule, unloadModule);
		}

		isBootstrappingHotReload = false;
	}

	store.world = world;
	loop.setWorlds({ world });
	loop.scheduleSystems([
		...staticSystems.filter((system) => !hotReloadSystems.includes(system)),
		...hotReloadSystems,
	]);
	worldDebugger.autoInitialize(loop);

	const clientPhases = RunService.IsClient()
		? {
				renderStepped: RunService.RenderStepped,
				...renderPriorityPhaseEvents,
			}
		: ({} as never);

	const phases = {
		default: RunService.Heartbeat,
		heartbeat: RunService.Heartbeat,
		postSimulation: RunService.PostSimulation,
		preAnimation: RunService.PreAnimation,
		preRender: RunService.PreRender,
		preSimulation: RunService.PreSimulation,
		stepped: RunService.Stepped,
		...clientPhases,
		...(customPhases as never as Record<keyof typeof customPhases, RBXScriptSignal>),
	};

	loop.begin(phases);

	return { crate: store.shared, debugger: worldDebugger, loop, world };
}
