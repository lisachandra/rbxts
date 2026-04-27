import { Workspace } from "@rbxts/services";

import { registry } from "../registry";
import { Components } from "../../components";
import { itemsSerializer, itemsDeserializer, type ItemData } from "./item";
import { store } from "@lisachandra/core/out/store";
import { getInstanceWithAttribute } from "@lisachandra/core/out/utils/main";
import createSerializer from "@rbxts/serio";

export type ItemsPayload = {
	items: Array<ItemData>;
};

const lastReplicatedItems: Record<string, Array<Components.Item>> = {};

registry.register<Components.Items, ItemsPayload>(createSerializer<ItemsPayload>(), {
	component: Components.Items,
	mode: "all",
	serializer: (record, _playerEntityId, componentEntityId) => {
		const key = `${componentEntityId}`;
		const [items, newReplicatedItems] = itemsSerializer(
			{ new: record.new!.items, old: record.old?.items },
			lastReplicatedItems[key] ?? [],
		);
		lastReplicatedItems[key] = newReplicatedItems;
		return { items };
	},
	deserializer: (data, serverEntityId, clientEntityId) => {
		const entityExists = clientEntityId !== undefined && store.world.contains(clientEntityId);
		const oldItems = entityExists
			? store.world.get(clientEntityId, Components.Items)!.items
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
			model: getInstanceWithAttribute(
				Workspace.Items.GetChildren(),
				"serverEntityId",
				serverEntityId,
			) as Model,
		};
	},
});
