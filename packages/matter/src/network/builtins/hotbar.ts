import { flip } from "@rbxts/sift/out/Dictionary";

import { registry } from "../registry";
import { Components } from "../../components";
import { itemsSerializer, itemsDeserializer, type ItemData } from "./item";
import { store } from "@lisachandra/core/out/store";
import createSerializer, { u16 } from "@rbxts/serio";

export type HotbarPayload = {
	items: Array<ItemData>;
	equipped?: u16;
};

const unpackTable: LuaGlobals["unpack"] = getfenv(0)["unpack" as never];
let lastReplicatedItems: Array<Components.Item> = [];

registry.register<Components.Hotbar, HotbarPayload>(createSerializer<HotbarPayload>(), {
	component: Components.Hotbar,
	mode: "owner",
	serializer: (record, _playerEntityId, _componentEntityId) => {
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems,
		);
		lastReplicatedItems = newReplicatedItems
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
			items: newItems.filter((item) => !removedGUIDs.includes(item.guid)),
			equipped:
				data.equipped !== undefined
					? flip(store.client.getState("itemGUIDMap"))[data.equipped]!
					: (undefined as never),
		};
	},
});
