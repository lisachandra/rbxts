import type { CrateDiff, InferCrateType } from "@rbxts/crate";
import { Crate } from "@rbxts/crate";
import Signal from "@rbxts/lemon-signal";
import type { AnyEntity, World } from "@rbxts/matter";
import { RunService, Workspace } from "@rbxts/services";
import { removeValues, values } from "@rbxts/sift/Dictionary";
import { iterate } from "./utils/type";
import Log from "@rbxts/log";
import { Document } from "@rbxts/lapis";

/**
 * Represents a single item in an inventory or hotbar.
 */
interface ItemData {
	guid: string;
	amount: number;
	data: object;
	id: Array<string>;
}

/**
 * Data structure for player collections including hotbar and inventory items.
 *
 * @remarks
 * Each collection maps a discriminator key to its corresponding item data.
 */
export interface CollectionData {}

let initialState: ClientState | ServerState;
const middleware: Array<{ key: string; middleware: Callback }> = [];

type ClientEntityId = AnyEntity;
type ServerEntityId = AnyEntity;

/**
 * Client-side state managed by the {@link store}.
 *
 * @remarks
 * Contains client-specific state such as debug settings,
 * entity ID mappings, and item pointer tables.
 */
export interface ClientState {
	debugEnabled: boolean;

	serverStartClock: number;
	serverStartEpoch: number;

	entityIdMap: Record<ServerEntityId, ClientEntityId>;
	itemGUIDMap: Record<string, number>;
	itemPointers: Record<string, string>;

	playerEntityId?: AnyEntity;
}

/**
 * Server-side state managed by the {@link store}.
 *
 * @remarks
 * Contains server-specific state including clock synchronization,
 * item mappings, and player document collections.
 */
export interface ServerState {
	serverStartClock: number;
	serverStartEpoch: number;

	itemGUIDMap: Record<string, number>;

	itemPointers: Record<string, string>;

	documents: Record<string, CollectionData>;
}

/**
 * An action dispatched to mutate the state crate.
 *
 * @typeParam S - The state type, either {@link ClientState} or {@link ServerState}.
 *
 * @remarks
 * Actions describe a change to the state. The `type` field identifies
 * the state key to modify, and `value` provides the new value.
 *
 * @example
 * ```ts
 * const action: Action<ClientState> = {
 *   type: "debugEnabled",
 *   value: true,
 * };
 * ```
 */
export interface Action<S extends ClientState | ServerState> {
	type: string | keyof S;
	key?: string;
	value?: unknown;
}

if (RunService.IsClient()) {
	initialState = {
		debugEnabled: false,

		entityIdMap: {},
		itemGUIDMap: {},
		itemPointers: {},

		playerEntityId: undefined as never,
		serverStartClock: undefined as never,
		serverStartEpoch: undefined as never,
	} satisfies ClientState;
} else {
	initialState = {
		serverStartClock: os.clock(),
		serverStartEpoch: Workspace.GetServerTimeNow(),

		itemGUIDMap: {},
		itemPointers: {},

		documents: {},
	} satisfies ServerState;
}

const crate = new Crate(initialState);
const diffSignal = new Signal<CrateDiff<InferCrateType<typeof crate>>>();

for (const data of middleware) {
	crate.useMiddleware(data.key as keyof InferCrateType<typeof crate>, data.middleware);
}

crate.useDiff((diff) => {
	diffSignal.Fire(diff);
});

const documents: Partial<Record<string, Document<CollectionData>>> = {};
if (RunService.IsServer()) {
	(crate as Crate<ServerState>).useMiddleware("documents", (oldValue, newValue) => {
		const difference = removeValues(oldValue, ...values(newValue));

		for (const [key, data] of iterate(difference)) {
			const document = documents[key];
			if (!document) {
				Log.Warn(`${key} document is modified from the store but it doesn't exist!`);
				continue;
			}

			document.write(data);
		}

		return newValue;
	});
}

/**
 * The central application store providing access to state crates,
 * the Matter world instance, hotbar storage, and document management.
 *
 * @remarks
 * The store is initialized with either {@link ClientState} or {@link ServerState}
 * depending on the runtime environment. It uses a {@link Crate} for state
 * management with diff-based change detection via {@link diffSignal}.
 */
export const store = {
	/**
	 * Client state crate.
	 *
	 * @client
	 */
	client: crate as unknown as Crate<ClientState>,

	/**
	 * Server state crate.
	 *
	 * @server
	 */
	server: crate as unknown as Crate<ServerState>,

	/** Shared state crate. */
	shared: crate,

	/** Matter world instance. */
	world: undefined as unknown as World,

	/**
	 * A storage folder containing tools for entities.
	 *
	 * @server
	 */
	hotbar: new Instance("Folder"),

	/** A signal that wraps on the crate's useDiff function. */
	diffSignal,

	/**
	 * Stores loaded player documents. Keyed by discriminator string.
	 * @server
	 */
	documents,
};
