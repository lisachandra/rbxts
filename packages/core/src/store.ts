import type { CrateDiff, InferCrateType } from "@rbxts/crate";
import { Crate } from "@rbxts/crate";
import Signal from "@rbxts/lemon-signal";
import type { AnyEntity, World } from "@rbxts/matter";
import { RunService, Workspace } from "@rbxts/services";

export type CollectionData = {}

let initialState: ClientState | ServerState;
const middleware: Array<{ key: string; middleware: Callback }> = [];

type ClientEntityId = AnyEntity;
type ServerEntityId = AnyEntity;

export interface ClientState {
	debugEnabled: boolean;

	serverStartClock: number;
	serverStartEpoch: number;

	entityIdMap: Record<ServerEntityId, ClientEntityId>;
	itemGUIDMap: Record<string, number>;
	itemPointers: Record<string, string>;

	playerEntityId?: AnyEntity;
}

export interface ServerState {
	serverStartClock: number;
	serverStartEpoch: number;

	itemGUIDMap: Record<string, number>;

	itemPointers: Record<string, string>;

	documents: Record<string, CollectionData>;
}

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

export default {
	client: crate as unknown as Crate<ClientState>,

	server: crate as unknown as Crate<ServerState>,

	shared: crate,

	world: undefined as unknown as World,

	hotbar: new Instance("Folder"),

	diffSignal,
};
