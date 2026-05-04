import { flip } from "@rbxts/sift/out/Dictionary";

import { registry } from "../registry";
import { Components, getComponent, Item } from "../../components";
import { type ItemData, itemsDeserializer, itemsSerializer } from "./item";
import { store } from "@lisachandra/core/out/store";
import createSerializer, { u16 } from "@rbxts/serio";

/**
 * Payload structure for replicating the {@link Components.Hotbar} component.
 *
 * @remarks
 * Includes the hotbar items and an optional equipped item numeric ID.
 */
export type HotbarPayload = {
	items: Array<ItemData>;
	equipped?: u16;
};

const lastReplicatedItems: Array<Item> = [];

registry.register<Components["Hotbar"], HotbarPayload>({
	component: getComponent("Hotbar"),
	serdes: createSerializer<HotbarPayload>(),
	mode: "owner",
	serializer: (record, _playerEntityId, _componentEntityId) => {
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems,
		);
		lastReplicatedItems.clear();
		for (const i of newReplicatedItems) {
			lastReplicatedItems.push(i)
		}
		return {
			items,
			equipped:
				store.server.getState("itemGUIDMap")[
					(record.old?.equipped !== record.new!.equipped ? record.new!.equipped : undefined)!
				],
		};
	},
	deserializer: (data, _serverEntityId, clientEntityId) => {
		const entityExists = clientEntityId !== undefined && store.world.contains(clientEntityId);
		const oldItems = entityExists
			? store.world.get(clientEntityId, getComponent("Hotbar"))!.items
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
			equipped:
				data.equipped !== undefined
					? flip(store.client.getState("itemGUIDMap"))[data.equipped]!
					: (undefined as never),
		};
	},
});
