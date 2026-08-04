import { store } from "@lisachandra/core/store";
import type { u16 } from "@rbxts/serio";
import { flip } from "@rbxts/sift/Dictionary";

import type { Item } from "../../components";
import { Components } from "../../components";
import { registry } from "../registry";
import { type ItemData, itemsDeserializer, itemsSerializer } from "./item";

/**
 * Payload structure for replicating the {@link Components.Hotbar} component.
 *
 * @remarks
 *   Includes the hotbar items and an optional equipped item numeric ID.
 */
export interface HotbarPayload {
	equipped?: u16;
	items: Array<ItemData>;
}

const lastReplicatedItems: Array<Item> = [];

registry.register<Components["Hotbar"], HotbarPayload>({
	component: Components.Hotbar,
	deserializer: (data, _serverEntityId, clientEntityId) => {
		const entityExists = clientEntityId !== undefined && store.world.contains(clientEntityId);
		const oldItems = entityExists
			? store.world.get(clientEntityId, Components.Hotbar)!.items
			: undefined;
		const [newItems, removedGUIDs] = itemsDeserializer(data.items, oldItems);
		if (oldItems) {
			for (const oldItem of oldItems) {
				const newItem = newItems.find((item) => item.guid === oldItem.guid);
				if (!newItem) {
					newItems.push(oldItem);
				}
			}
		}

		return {
			equipped:
				data.equipped !== undefined
					? flip(store.client.getState("itemGUIDMap"))[data.equipped]!
					: undefined,
			items: newItems.filter((item) => !removedGUIDs.includes(item.guid)),
		};
	},
	mode: "owner",
	serializer: (record, _playerEntityId, _componentEntityId) => {
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems,
		);
		lastReplicatedItems.clear();
		for (const i of newReplicatedItems) {
			lastReplicatedItems.push(i);
		}

		return {
			equipped:
				store.server.getState("itemGUIDMap")[
					(record.old?.equipped !== record.new!.equipped
						? record.new!.equipped
						: undefined)!
				],
			items,
		};
	},
});
