/*
 * This system synchronizes in-game items with corresponding tools in the
 * player's hotbar. It creates tools for newly added items and ensures proper
 * cleanup when items are removed. It also manages NPC hotbar's and their
 * associated tools.
 */
import type { Crate } from "@rbxts/crate";
import type { DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { equals as equals } from "@rbxts/sift/out/Array";

import { meta as itemManager } from "./itemManager";
import { getItemTool } from "../../../utils/item";
import { ServerState, store } from "@lisachandra/core/out/store";
import { getComponent, Item } from "../../../components";

function handleToolCreation(itemsToAdd: Array<Item>, hotbar: Instance): void {
	for (const item of itemsToAdd) {
		const tool = item.tool ?? getItemTool(item.id)!.Clone();

		tool.SetAttribute("guid", item.guid);
		tool.Parent = hotbar;
		item.tool = tool;
	}
}

/* Handles synchronization of tools in the hotbar with in-game items. */
function system(world: World): void {
	for (const [entityId, record] of world.queryChanged(getComponent("Hotbar"))) {
		if (
			(record.old || !record.new) &&
			(!record.new || !record.old || equals(record.new.items, record.old.items))
		) {
			continue;
		}

		const itemsToRemove =
			record.old?.items.filter(
				(oldItem) => !record.new!.items.some((newItem) => oldItem.guid === newItem.guid),
			) ?? [];

		const itemsToAdd = record.old
			? record.new.items
					.filter(
						(newItem) =>
							!record.old!.items.some((oldItem) => oldItem.guid === newItem.guid),
					)
					.filter((item) => !itemsToRemove.includes(item))
			: record.new.items;

		const profile = world.get(entityId, getComponent("Profile"));
		const hotbar = profile
			? profile.player.Backpack!
			: (store.hotbar.FindFirstChild(`${entityId}`) ?? new Instance("Folder"));

		handleToolCreation(itemsToAdd, hotbar);
	}
}

export const meta = {
	after: [itemManager],
	phase: "preAnimation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
