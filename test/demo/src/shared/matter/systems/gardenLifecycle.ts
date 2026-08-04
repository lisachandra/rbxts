import type { ClientState, ServerState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";

function system(_world: World): void {}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState | ServerState>, ui: DebugWidgets]>;
