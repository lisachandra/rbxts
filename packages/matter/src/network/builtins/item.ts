import Log from "@rbxts/log";
import { isEmpty } from "@rbxts/object-utils";
import type { Serializer, u16 } from "@rbxts/serio";
import { filter, flip } from "@rbxts/sift/Dictionary";
import { store } from "@lisachandra/core/store";
import { required } from "@lisachandra/core/utils/type";

import { getItemIdFromNumericId, getNumericItemIdFromId } from "../../utils/item";
import type { ValidItemPath } from "../../items";
import { privateDefinitions, serdes } from "../../items";
import { Item } from "../../components";

/**
 * Serialized item data sent over the network.
 *
 * @remarks
 * When only a `guid` is present, the item has been removed.
 * Otherwise, the full item payload is included with amount, numeric id, guid,
 * and optional serialized blobs/buffer.
 */
export type ItemData = { guid: u16 } | {
	blobs: unknown;
	buf?: buffer;
	amount: u16;
	guid: u16;
	id: u16;
}

function findItemSerdes<T>(itemId: ValidItemPath): Serializer<T> {
	let dataSerdes: N<Serializer<T>>;
	let currentPath: N<{ [K: string]: unknown; serdes?: Serializer<T> }>;
	const parents: Array<Record<string, unknown>> = [];

	for (const key of itemId) {
		currentPath ??= serdes as never;
		parents.push(currentPath);
		currentPath = (currentPath[key] ?? {}) as never;
	}

	while (!dataSerdes) {
		if (currentPath === undefined) {
			Log.Warn(`Possibly missing SerDes for item path? (${itemId.join(".")})`);
		}

		if (currentPath?.serdes !== undefined) {
			dataSerdes = currentPath.serdes;
		}

		currentPath = parents.pop()!;
	}

	return dataSerdes;
}

function getReplicatedData(
	item: Item,
): [newData: Partial<Item["data"]>, unreplicatedData: Partial<Item["data"]>] {
	const newData = table.clone(item.data);
	const unreplicatedData = {};
	let unreplicatedKeys: Array<string> = [];

	for (const [itemId, excludedKeys] of privateDefinitions) {
		if (itemId.some((str) => item.id.includes(str as never))) {
			unreplicatedKeys = excludedKeys;
		}
	}

	for (const key of unreplicatedKeys) {
		unreplicatedData[key as never] = newData[key as never];
		delete newData[key as never];
	}

	return [newData, unreplicatedData];
}

function isItemReplicateSafe(
	item: Item,
): [safe: false] | [safe: true, itemId: number, guidId: number] {
	const itemId = getNumericItemIdFromId(item.id);
	if (itemId === undefined) {
		Log.Error("Numeric itemId is nil for", item);
		return [false];
	}

	const guidId = store.server.getState("itemGUIDMap")[item.guid];
	if (guidId === undefined) {
		Log.Error("GUIDId does not exist for item:", item);
		return [false];
	}

	return [true, itemId, guidId];
}

function shouldItemBeReplicated(
	item: Item,
	newData: Partial<Item["data"]>,
	lastReplicatedItems: Array<Item>,
):
	| [shouldBeReplicated: false]
	| [shouldBeReplicated: true, filteredNewData: Partial<Item["data"]>] {
	const oldReplicatedItem = lastReplicatedItems.find((value) => value.guid === item.guid);
	const filteredNewData = oldReplicatedItem
		? filter(newData, (value, key) => oldReplicatedItem.data[key] !== value)
		: newData;

	if (isEmpty(filteredNewData) && oldReplicatedItem && oldReplicatedItem.amount === item.amount) {
		return [false];
	}

	return [true, filteredNewData];
}

function serializeSingleItem(
	item: Item,
	lastReplicatedItems: Array<Item>,
): N<ItemData> {
	const [replicateSafe, numericId, guidId] = isItemReplicateSafe(item);
	if (!replicateSafe) {
		return;
	}

	const [newData] = getReplicatedData(item);
	const [shouldBeReplicated, filteredNewData] = shouldItemBeReplicated(
		item,
		newData,
		lastReplicatedItems,
	);
	if (!shouldBeReplicated) {
		return;
	}

	let serializedNewData: N<{ blobs: Array<defined>; buf: buffer }>;
	if (!isEmpty(filteredNewData)) {
		const dataSerdes = findItemSerdes(item.id);
		serializedNewData = required(dataSerdes.serialize(filteredNewData));
	}

	return {
		amount: item.amount,
		blobs: serializedNewData?.blobs,
		buf: serializedNewData?.buf,
		guid: guidId,
		id: numericId,
	};
}

/**
 * Serializes item data for network replication. This function compares new and
 * old item states to generate a concise update packet, minimizing bandwidth
 * usage. It handles data serialization using Squash and manages unreplicated
 * properties. It also updates the server's replicated item list.
 *
 * @param items - An object containing arrays of new and optionally old items.
 * @param lastReplicatedItems - The last set of items that were replicated to
 *   the client.
 * @returns A tuple containing the serialized item data for the network packet
 *   and an updated list of replicated items.
 */
export function itemsSerializer(
	items: { new: Array<Item>; old?: Array<Item> },
	lastReplicatedItems: Array<Item>,
): [
	serializedItems: Array<ItemData>,
	newReplicatedItems: Array<Item>,
] {
	const serializedItems: Array<ItemData> = [];
	const newReplicatedItems: Array<Item> = [];

	for (const item of items.new) {
		const serializedItem = serializeSingleItem(item, lastReplicatedItems);
		if (serializedItem) {
			const [newData, unreplicatedData] = getReplicatedData(item);
			serializedItems.push(serializedItem);
			newReplicatedItems.push({
				...item,
				data: { ...newData, ...unreplicatedData } as Item["data"],
			});
		}
	}

	if (items.old) {
		for (const item of items.old) {
			const itemRemoved = !items.new.some((newItem) => newItem.guid === item.guid);
			if (!itemRemoved) {
				continue;
			}

			serializedItems.push({ guid: store.server.getState("itemGUIDMap")[item.guid]! });
		}
	}

	return [serializedItems, newReplicatedItems];
}

function deserializeItemData(
	item: ItemData,
	itemId: ValidItemPath,
): N<Item["data"]> {
	if (!("buf" in item)) {
		return;
	}

	const dataSerdes = findItemSerdes(itemId);
	return dataSerdes.deserialize({ blobs: item.blobs as defined[], buf: item.buf }) as Item["data"];
}

/**
 * Deserializes item data received from the server, updating existing items and
 * removing deleted ones.
 *
 * @param items - An array of item data received from the server.
 * @param oldItems - An optional array of existing item components for
 *   comparison and updates.
 * @returns A tuple containing the new array of item components and an array of
 *   GUIDs of removed items.
 */
export function itemsDeserializer(
	items: Array<ItemData>,
	oldItems?: Array<Item>,
): [newItems: Array<Item>, removedItems: Array<string>] {
	const newItems: Array<Item> = [];
	const removedItems: Array<string> = [];
	const flippedGUIDMap = flip(store.client.getState("itemGUIDMap"));

	for (const item of items) {
		const itemGUID = flippedGUIDMap[item.guid];
		if (itemGUID === undefined) {
			continue;
		}

		if (!("id" in item)) {
			removedItems.push(itemGUID);
			continue;
		}

		const itemId = getItemIdFromNumericId(item.id);
		assert(itemId !== undefined, `Replicated ID for Item is nil; ${item}`);

		const oldItem = (oldItems?.find((itemOld) => itemGUID === itemOld.guid) ?? {
			data: {},
		}) as Item;

		const deserializedItemData = deserializeItemData(item, itemId) ?? {};

		const data = {
			...oldItem.data,
			...deserializedItemData,
		};

		if (!("client" in data)) {
			data["client" as never] = {} as never;
		}

		newItems.push({
			amount: item.amount,
			data: data as never,
			guid: itemGUID,
			id: itemId,
			tool: oldItem.tool!,
		});
	}

	return [newItems, removedItems];
}
