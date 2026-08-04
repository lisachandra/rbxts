import type { ServerState } from "@lisachandra/core/store";
import { catcher, getHumanoid } from "@lisachandra/core/utils/main";
/*
 * This system manages item interactions, including moving items between
 * inventories, dropping them, and picking them up. It validates player actions
 * to ensure items are handled within allowable ranges and conditions. It
 * synchronizes item data across players and the game state.
 */
import type { Crate } from "@rbxts/crate";
import type { AnyEntity, DebugWidgets, SystemStruct, World } from "@rbxts/matter";
import { equals } from "@rbxts/sift/Array";
import {
	equals as dictionaryEquals,
	filter,
	flip,
	fromArrays,
	map,
	values,
} from "@rbxts/sift/Dictionary";

import type { ChangeRecord } from "../../../components";
import { Components, isComponent } from "../../../components";
import { useMessage } from "../../../hooks";
import { Message, messaging } from "../../../network";
import { getItemFromGUID, getItemTool, moveItem, removeItem, spawnItem } from "../../../utils/item";

const loadTimeout = 30;
const maxItems = 65535;

/** Maximum distance (studs) a player can be from an item to pick it up. */
const ITEM_PICKUP_RANGE = 15;

function validateItemPickup(
	world: World,
	humanoid: Humanoid,
	itemEntityId: AnyEntity,
	pickupRange: number,
): boolean {
	const { model } = world.get(itemEntityId, Components.Items) ?? { model: undefined };
	if (!model) {
		return false;
	}

	return humanoid.RootPart!.Position.sub(model.GetPivot().Position).Magnitude <= pickupRange;
}

function handleHotbarEquip(
	world: World,
	entityId: AnyEntity,
	itemPointers: ServerState["itemPointers"],
	guid: string,
	destination: boolean,
): N<ServerState["itemPointers"]> {
	const hotbar = world.get(entityId, Components.Hotbar)!;
	if (hotbar.equipped !== guid) {
		return;
	}

	for (const hotbarItem of hotbar.items) {
		if (!hotbarItem.tool || hotbarItem.guid === guid) {
			continue;
		}

		return moveItemTo(world, entityId, undefined, itemPointers, hotbarItem.guid, destination);
	}

	return undefined;
}

/* Moves an item between a player's inventory and hotbar, validating the action. */
function moveItemTo(
	world: World,
	entityId: AnyEntity,
	humanoid: N<Humanoid>,
	itemPointers: ServerState["itemPointers"],
	guid: string,
	destination: boolean,
): N<ServerState["itemPointers"]> {
	const [itemEntityIdStr, location] = itemPointers[guid]!.split("_") as [
		string,
		N<"Hotbar" | "Inventory">,
	];
	const itemEntityId = tonumber(itemEntityIdStr) as AnyEntity;
	const item = getItemFromGUID(guid)!;

	const arrival = destination ? "Inventory" : "Hotbar";

	if (arrival === location || (arrival === "Hotbar" && !getItemTool(item.id))) {
		return;
	}

	if (arrival === "Inventory") {
		const hotbarChange = handleHotbarEquip(world, entityId, itemPointers, guid, destination);
		if (hotbarChange) {
			return hotbarChange;
		}
	}

	if (
		humanoid &&
		itemEntityId !== entityId &&
		!validateItemPickup(world, humanoid, itemEntityId, ITEM_PICKUP_RANGE)
	) {
		return;
	}

	moveItem(entityId, guid, arrival);
	return { ...itemPointers, [guid]: `${itemEntityIdStr}_${arrival}` };
}

/* Drops an item from the player's inventory or hotbar into the world. */
function dropItem(
	entityId: AnyEntity,
	humanoid: Humanoid,
	itemPointers: ServerState["itemPointers"],
	guid: string,
	amount: number,
): N<ServerState["itemPointers"]> {
	const [itemEntityIdStr] = itemPointers[guid]!.split("_") as [string, N<"Hotbar" | "Inventory">];

	if (tonumber(itemEntityIdStr)! !== entityId) {
		return;
	}

	const item = removeItem(guid, amount)!;
	const cf = humanoid.RootPart!.CFrame.mul(new CFrame(0, 0, -1));

	const itemEntityId = spawnItem(item, cf);
	return { ...itemPointers, [guid]: `${itemEntityId}` };
}

function handlePlayerToolEquip(profile: Components["Profile"], equippedTool: N<Tool>): void {
	// Equip the tool to the player if found.
	if (equippedTool !== undefined) {
		equippedTool.Parent = profile.player;
	}

	// Move all tools from the backpack to the player.
	for (const tool of profile.player.Backpack!.GetChildren()) {
		if (tool.IsA("Tool")) {
			tool.Parent = profile.player;
		}
	}

	// Move all tools to the backpack and equip previous tool when the character is added again.
	profile.player.CharacterAdded.Once((playerCharacter) => {
		for (const tool of profile.player.GetChildren()) {
			if (tool.IsA("Tool")) {
				tool.Parent = profile.player.Backpack;
			}
		}

		const humanoid = playerCharacter.WaitForChild<Humanoid>("Humanoid", loadTimeout);
		if (humanoid !== undefined && equippedTool) {
			humanoid.EquipTool(equippedTool);
		}
	});
}

type ItemRelatedComponents = Components["Items"] | Components["Hotbar"] | Components["Inventory"];

function cleanupItemPointers(
	record: ChangeRecord<ItemRelatedComponents>,
	itemPointers: ServerState["itemPointers"],
): ServerState["itemPointers"] {
	let moved: N<boolean>;

	if (isComponent(record.old, "Items")) {
		record.old.model.Destroy();
		({
			old: { moved },
		} = record);
	}

	if (!(moved ?? false)) {
		return filter(itemPointers, (_, key) => {
			return record.old!.items.some((item) => key !== item.guid);
		}) as Record<string, string>;
	}

	return itemPointers;
}

function determineItemPointer(entityId: AnyEntity, name: "Items" | "Hotbar" | "Inventory"): string {
	return name === "Items" ? `${entityId}` : `${entityId}_${name}`;
}

function filterItemsToAdd(
	record: ChangeRecord<Components["Items"] | Components["Hotbar"] | Components["Inventory"]>,
	updatedItemPointers: ServerState["itemPointers"],
	pointer: string,
): Array<string> {
	const itemsToRemove =
		record.old?.items
			.filter(
				(oldItem) => !record.new!.items.some((newItem) => oldItem.guid === newItem.guid),
			)
			.map((item) => item.guid) ?? [];

	return record
		.new!.items.filter((item) => {
			return (
				updatedItemPointers[item.guid] === undefined ||
				updatedItemPointers[item.guid] !== pointer
			);
		})
		.filter((item) => !itemsToRemove.includes(item.guid))
		.map((item) => item.guid);
}

function handleItemChanges(
	entityId: AnyEntity,
	name: "Items" | "Hotbar" | "Inventory",
	record: ChangeRecord<Components["Items"] | Components["Hotbar"] | Components["Inventory"]>,
	newItemPointers: ServerState["itemPointers"],
): ServerState["itemPointers"] {
	const updatedItemPointers = newItemPointers;

	if (
		(record.old || !record.new) &&
		(!record.new || !record.old || equals(record.new.items, record.old.items))
	) {
		// Handle component removal and item pointer cleanup.
		if (!record.new && record.old) {
			return cleanupItemPointers(record, updatedItemPointers);
		}

		return updatedItemPointers;
	}

	// Determine the pointer for the item based on the component type.
	const pointer = determineItemPointer(entityId, name);

	// Filter items to add and remove based on existing pointers and component changes.
	const itemsToAdd = filterItemsToAdd(record, updatedItemPointers, pointer);

	// Update item pointers with added and removed items.
	return {
		...updatedItemPointers,
		...fromArrays(itemsToAdd, table.create(itemsToAdd.size(), pointer)),
	};
}

function handlePlayerToolSync(world: World): void {
	for (const [_, profile] of world.query(Components.Profile)) {
		const character = profile.player.Character;
		if (
			!getHumanoid(profile.player) &&
			character !== undefined &&
			!profile.player.FindFirstChildWhichIsA("Tool")
		) {
			const equippedTool = character.FindFirstChildWhichIsA("Tool");
			handlePlayerToolEquip(profile, equippedTool);
		}
	}
}

function resyncItems(state: ServerState, player: Player, guid: string): void {
	if (state.itemGUIDMap[guid] === undefined) {
		messaging.client.emit(player, Message.ResyncItem, guid);
	}
}

function handleMoveItemPacket(
	world: World,
	newItemPointers: ServerState["itemPointers"],
	player: Player,
	flippedItemGUIDMap: Record<string, string>,
	data: { destination: boolean; guid: number },
): N<ServerState["itemPointers"]> {
	const humanoid = getHumanoid(player);
	if (!humanoid) {
		return newItemPointers;
	}

	const entityId = player.GetAttribute<AnyEntity>("serverEntityId")!;
	const guid = flippedItemGUIDMap[data.guid]!;

	return (
		moveItemTo(world, entityId, humanoid, newItemPointers, guid, data.destination) ??
		newItemPointers
	);
}

function handleDropItemPacket(
	newItemPointers: ServerState["itemPointers"],
	player: Player,
	flippedItemGUIDMap: Record<string, string>,
	data: { amount: number; guid: number },
): N<ServerState["itemPointers"]> {
	const humanoid = getHumanoid(player);
	if (!humanoid) {
		return newItemPointers;
	}

	const entityId = player.GetAttribute<AnyEntity>("serverEntityId")!;
	const guid = flippedItemGUIDMap[data.guid]!;

	return dropItem(entityId, humanoid, newItemPointers, guid, data.amount) ?? newItemPointers;
}

function updateItemPointers(
	world: World,
	newItemPointers: ServerState["itemPointers"],
): ServerState["itemPointers"] {
	let updatedItemPointers = newItemPointers;
	for (const name of ["Inventory", "Hotbar", "Items"] as const) {
		for (const [entityId, record] of world.queryChanged(Components[name])) {
			updatedItemPointers = handleItemChanges(entityId, name, record, updatedItemPointers);
		}
	}

	return updatedItemPointers;
}

function generateUnusedIds(state: ServerState): Array<number> {
	const usedIds: Array<number> = values(state.itemGUIDMap);
	const unusedIds: Array<number> = table.create(maxItems - usedIds.size());

	for (const index of $range(0, maxItems - 1)) {
		if (!usedIds.includes(index)) {
			unusedIds.push(index);
		}
	}

	return unusedIds;
}

function createNewItemGUIDMap(
	state: ServerState,
	newItemPointers: ServerState["itemPointers"],
	unusedIds: Array<number>,
): Record<string, number> {
	return map(newItemPointers, (_, guid) => {
		return $tuple(state.itemGUIDMap[guid] ?? unusedIds.shift()!, guid);
	});
}

/*
 * Handles item interactions (moving, dropping, spawning) and synchronizes with
 * the game state.
 */
function system(world: World, crate: Crate<ServerState>): void {
	handlePlayerToolSync(world);

	const state = crate.getState();
	const flippedItemGUIDMap = flip(state.itemGUIDMap);
	let newItemPointers = state.itemPointers;

	for (const [_, player, guid] of useMessage(messaging.server, Message.ResyncItem)) {
		resyncItems(state, player, guid);
	}

	for (const [_, player, data] of useMessage(messaging.server, Message.MoveItemTo)) {
		newItemPointers =
			handleMoveItemPacket(world, newItemPointers, player, flippedItemGUIDMap, data) ??
			newItemPointers;
	}

	for (const [_, player, data] of useMessage(messaging.server, Message.DropItem)) {
		newItemPointers =
			handleDropItemPacket(newItemPointers, player, flippedItemGUIDMap, data) ??
			newItemPointers;
	}

	newItemPointers = updateItemPointers(world, newItemPointers);

	if (dictionaryEquals(newItemPointers, state.itemPointers)) {
		return;
	}

	crate.update({ itemPointers: () => newItemPointers }).catch(catcher);

	const unusedIds = generateUnusedIds(state);
	const newItemGUIDMap = createNewItemGUIDMap(state, newItemPointers, unusedIds);

	if (dictionaryEquals(newItemGUIDMap, state.itemGUIDMap)) {
		return;
	}

	crate.update({ itemGUIDMap: () => newItemGUIDMap }).catch(catcher);

	const newGUIDs = filter(newItemGUIDMap, (_, guid) => !(guid in state.itemGUIDMap)) as Record<
		string,
		number
	>;

	messaging.client.emitAll(Message.ItemGUIDMap, newGUIDs);
}

export const meta = {
	phase: "preAnimation",
	system,
} satisfies SystemStruct<[world: World, crate: Crate<ServerState>, ui: DebugWidgets]>;
