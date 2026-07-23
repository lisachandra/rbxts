import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ClientState, ServerState } from "@lisachandra/core/store";

function system(_world: World): void {}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState | ServerState>, ui: DebugWidgets]>;
