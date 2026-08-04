import { store } from "@lisachandra/core/store";

import type { Item } from "../../components";
import { Components } from "../../components";
import { registry } from "../registry";
import { type ItemData, itemsDeserializer, itemsSerializer } from "./item";

/** Payload structure for replicating the {@link Components.Inventory} component. */
export interface InventoryPayload {
	items: Array<ItemData>;
}

const lastReplicatedItems: Record<string, Array<Item>> = {};

registry.register<Components["Inventory"], InventoryPayload>({
	component: Components.Inventory,
	deserializer: (data, _serverEntityId, clientEntityId) => {
		const entityExists = clientEntityId !== undefined && store.world.contains(clientEntityId);
		const oldItems = entityExists
			? store.world.get(clientEntityId, Components.Inventory)!.items
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
			items: newItems.filter((item) => !removedGUIDs.includes(item.guid)),
		};
	},
	mode: "owner",
	serializer: (record, _playerEntityId, componentEntityId) => {
		const key = `${componentEntityId}`;
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems[key] ?? [],
		);
		lastReplicatedItems[key] = newReplicatedItems;
		return { items };
	},
});
