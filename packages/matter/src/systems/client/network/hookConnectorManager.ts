import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import type { ComponentCtor } from "@rbxts/matter/lib/component";

import type { ClientState } from "@lisachandra/core/store";
import { HookConnector } from "../../../hookConnector";

function system(world: World, crate: Crate<ClientState>): void {
	if (!crate.getState("playerEntityId")) {
		return;
	}

	const requestsByComponent = new Map<ComponentCtor, Array<[entityId: unknown, callback: Callback]>>();

	for (const [, request] of pairs(HookConnector.componentRecordRequests)) {
		const component = request.component as unknown as ComponentCtor;
		const bucket = requestsByComponent.get(component) ?? [];
		bucket.push([request.entityId, request.callback as Callback]);
		requestsByComponent.set(component, bucket);
	}

	for (const [component, callbacks] of requestsByComponent) {
		for (const [entityId, record] of world.queryChanged(component)) {
			for (const [requestedEntityId, callback] of callbacks) {
				if (requestedEntityId !== entityId) {
					continue;
				}

				callback(record);
			}
		}
	}
}

export const meta = {
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
