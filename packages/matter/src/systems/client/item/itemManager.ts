/*
 * This system synchronizes item states between the client and server. It
 * handles item addition, removal, and updates within the player's inventory and
 * hotbar. It ensures that item interactions and data remain consistent across
 * the game.
 */
import { ClientState } from "@lisachandra/core/store";
import type { Crate } from "@rbxts/crate";
import Log from "@rbxts/log";
import type { Component, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { Players } from "@rbxts/services";
import { equals as equals } from "@rbxts/sift/Array";
import { count, equals as dictionaryEquals, fromArrays, removeKeys, } from "@rbxts/sift/Dictionary";

import { meta as replicationManager } from "../network/replicationManager";
import { useMessage, useThrottle } from "../../../hooks";
import { catcher, getInstanceWithAttribute } from "@lisachandra/core/utils/main";
import { iterate } from "@lisachandra/core/utils/type";
import { ChangeRecord, Components, isComponent, Item } from "../../../components";
import { Message, messaging } from "../../../network";


/** Interval (seconds) between periodic item resyncs with the server. */
const ITEM_RESYNC_INTERVAL = 60;
/**
 * Handles incoming `ResyncItem` packets from the server. Removes the specified
 * GUID from the client's `itemGUIDMap`, triggering a resync of the item from
 * the server.
 *
 * @param crate - The Crate instance containing the client state.
 */
function handleResyncItem(crate: Crate<ClientState>): void {
	for (const [_, guid] of useMessage(messaging.client, Message.ResyncItem)) {
		Log.Verbose("Resyncing item {info}", { guid });
		crate
			.update({ itemGUIDMap: (itemGUIDMap) => removeKeys(itemGUIDMap, guid) })
			.catch(catcher);
	}
}

/**
 * Periodically resynchronizes all items in the client's `itemGUIDMap` with the
 * server. Sends a `ResyncItem` packet for each GUID in the map.
 *
 * @param crate - The Crate instance containing the client state.
 */
function resyncItems(crate: Crate<ClientState>): void {
	if (!useThrottle(ITEM_RESYNC_INTERVAL)) {
		return;
	}

	const itemGUIDMap = crate.getState("itemGUIDMap");

	for (const [guid] of iterate(itemGUIDMap)) {
		messaging.server.emit(Message.ResyncItem, guid);
	}
}

/**
 * Calculates the changes in item lists between old and new component states.
 * Determines which items need to be added or removed from the client's view.
 *
 * @param record - The change record containing the old and new component state.
 * @param newItemPointers - A dictionary mapping item GUIDs to their
 *   corresponding UI element pointers.
 * @param pointer - The UI element pointer associated with the current
 *   component.
 * @returns An object containing two arrays: `itemsToAdd` and `itemsToRemove`.
 */
function getItemChanges(
	record: ChangeRecord<Components["Items"] | Components["Hotbar"] | Components["Inventory"]>,
	newItemPointers: Record<string, string>,
	pointer: string,
): { itemsToAdd: Array<string>; itemsToRemove: Array<string> } {
	const itemsToRemove = isComponent(record.old, "Items")
		? []
		: (record.old?.items
				.filter(
					(oldItem) =>
						!record.new!.items.some((newItem) => oldItem.guid === newItem.guid),
				)
				.map((item) => item.guid) ?? []);

	const itemsToAdd = record
		.new!.items.filter((item) => {
			return (
				newItemPointers[item.guid] === undefined || newItemPointers[item.guid] !== pointer
			);
		})
		.filter((item) => !itemsToRemove.includes(item.guid))
		.map((item) => item.guid);

	return { itemsToAdd, itemsToRemove };
}

/**
 * Updates the `itemPointers` dictionary for a given component (Hotbar,
 * Inventory, or Items). Iterates through changed components, identifies added
 * items, and updates their pointers in the `itemPointers` dictionary.
 *
 * @param world - The Matter world instance.
 * @param name - The name of the component ("Hotbar", "Inventory", or "Items").
 * @param newItemPointers - The current `itemPointers` dictionary.
 * @returns The updated `itemPointers` dictionary.
 */
function updateItemPointersForComponent(
	world: World,
	name: "Items" | "Hotbar" | "Inventory",
	newItemPointers: Record<string, string>,
): Record<string, string> {
	let updatedPointers = newItemPointers;
	for (const [entityId, record] of world.queryChanged(Components[name])) {
		if (
			(record.old || !record.new) &&
			(!record.new || !record.old || equals(record.new.items, record.old.items))
		) {
			continue;
		}

		const pointer = name === "Items" ? `${entityId}` : `${entityId}_${name}`;
		const { itemsToAdd } = getItemChanges(record, updatedPointers, pointer);

		updatedPointers = {
			...updatedPointers,
			...fromArrays(itemsToAdd, table.create(itemsToAdd.size(), pointer)),
		};
	}

	return updatedPointers;
}

/**
 * Updates tool references for Hotbar and Inventory items. Assigns the actual
 * Tool instance to the item component if a matching tool is found in the
 * player's character or backpack.
 *
 * @param world - The Matter world instance.
 * @param state - The current client state.
 * @param name - The name of the component ("Hotbar" or "Inventory").
 */
function updateToolReferences(
	world: World,
	state: ClientState,
	name: "Items" | "Hotbar" | "Inventory",
): void {
	if (name === "Items") {
		return;
	}

	const component: Component<{ items: Array<Item> }> = world.get(
		state.playerEntityId!,
		Components[name],
	)!;
	const backpack = Players.LocalPlayer.FindFirstChildWhichIsA("Backpack")!;

	for (const item of component.items) {
		if (item.tool !== undefined) {
			continue;
		}

		const tool =
			getInstanceWithAttribute(
				Players.LocalPlayer.GetChildren() as Array<Tool>,
				"guid",
				item.guid,
			) ?? getInstanceWithAttribute(backpack.GetChildren() as Array<Tool>, "guid", item.guid);

		if (tool !== undefined) {
			item.tool = tool;
		}
	}
}

/**
 * Updates the `itemPointers` state with the latest item-to-pointer mappings.
 * Iterates through Inventory, Hotbar, and Items components, updates pointers,
 * and applies changes to the client state.
 *
 * @param world - The Matter world instance.
 * @param crate - The Crate instance containing the client state.
 */
function updateItemPointers(world: World, crate: Crate<ClientState>): void {
	const state = crate.getState();
	let newItemPointers = state.itemPointers;

	Log.Verbose("Updating item pointers {info}", {
		currentPointerCount: count(newItemPointers),
	});

	for (const name of ["Inventory", "Hotbar", "Items"] as const) {
		newItemPointers = updateItemPointersForComponent(world, name, newItemPointers);
		updateToolReferences(world, state, name);
	}

	if (dictionaryEquals(newItemPointers, state.itemPointers)) {
		return;
	}

	crate.update({ itemPointers: () => newItemPointers }).catch(catcher);
}

function system(world: World, crate: Crate<ClientState>): void {
	handleResyncItem(crate);
	resyncItems(crate);

	if (!crate.getState("playerEntityId")) {
		return;
	}

	updateItemPointers(world, crate);
}

export const meta = {
	after: [replicationManager],
	phase: "preRender",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ClientState>, ui: DebugWidgets]>;
