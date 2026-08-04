import type { ClientState } from "@lisachandra/core/store";
/*
 * This system ensures the player's hotbar order is consistent with their
 * equipped items. It synchronizes item positions in the hotbar and
 * automatically resolves any inconsistencies. It maintains a seamless user
 * experience when managing items.
 */
import type { Crate } from "@rbxts/crate";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { equals } from "@rbxts/sift/Array";

import { Components } from "../../../components";
import { meta as itemManager } from "./itemManager";

/*
 * Ensures the hotbar order is consistent and up-to-date by checking item GUIDs.
 * Synchronizes the player's hotbar order with their equipped items.
 * Automatically appends unequipped items to the hotbar order if missing.
 * Patches world components when discrepancies in the order are detected
 */
function system(world: World, crate: Crate<ClientState>): void {
	if (!crate.getState("playerEntityId")) {
		return;
	}

	const clientEntityId = crate.getState("playerEntityId")! as AnyEntity;

	const hotbar = world.get(clientEntityId, Components.Hotbar)!;
	const currentOrder = hotbar.order ?? [];
	const hotbarGUIDs = new Set(hotbar.items.map((item) => item.guid));
	const newOrder = currentOrder.filter((guid) => hotbarGUIDs.has(guid));

	for (const item of hotbar.items) {
		if (!newOrder.includes(item.guid)) {
			newOrder.push(item.guid);
		}
	}

	/*
	 * Synchronize the hotbar order with the player's inventory.
	 * Missing items are appended above to avoid de-synchronization.
	 */
	if (hotbar.order === undefined || !equals(currentOrder, newOrder)) {
		world.insert(clientEntityId, hotbar.patch({ order: newOrder }));
	}
}

export const meta = {
	after: [itemManager],
	phase: "preRender",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
