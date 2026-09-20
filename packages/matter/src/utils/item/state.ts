import { store } from "@lisachandra/core/store";
import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import type { AnyEntity, Component, World } from "@rbxts/matter";
import { HttpService, Workspace } from "@rbxts/services";
import { removeValue } from "@rbxts/sift/Array";

import type { Item } from "../../components";
import { Components } from "../../components";
import type { ValidItemPath } from "../../items/definitions";
import type { ItemContainer, ItemHierarchyIds } from "../../items/types";
import { itemEntityId, parseItemPointer } from "../itemPointer";
import { getItemModel, isSameId } from "./lookup";

/**
 * Adds an item to either the hotbar or inventory. If an item with the same ID exists, it increments
 * the amount.
 *
 * @template P
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity in the world.
 * @param location - The location to add the item to ("Hotbar" or "Inventory").
 * @param itemToAdd - The item to add.
 */
export function addItem<P extends ValidItemPath>(
	world: World,
	entityId: AnyEntity,
	location: "Hotbar" | "Inventory",
	itemToAdd: Item<P>,
): void {
	const component = world.get(entityId, Components[location])! as ItemContainer;

	for (const item of component.items) {
		if (!isSameId(item.id, itemToAdd.id)) {
			continue;
		}

		world.insert(
			entityId,
			component.patch({
				items: [
					...component.items.map((existingItem) => {
						return existingItem.id === item.id
							? {
									...existingItem,
									amount: existingItem.amount + itemToAdd.amount,
								}
							: existingItem;
					}),
				],
			}),
		);

		return;
	}

	world.insert(
		entityId,
		component.patch({
			items: [...component.items, itemToAdd],
		}),
	);
}

/**
 * Retrieves an item by its GUID.
 *
 * @template P
 * @param world - The Matter world instance.
 * @param guid - The GUID of the item.
 * @returns The matching item, or undefined if not found.
 */
export function getItemFromGUID<P extends ValidItemPath>(world: World, guid: string): N<Item<P>> {
	const itemPointers = store.shared.getState("itemPointers");

	if (itemPointers[guid] === undefined) {
		return;
	}

	const pointer = parseItemPointer(itemPointers[guid]);
	if (pointer === undefined || !world.contains(pointer.entityId)) {
		return;
	}

	const itemContainer = pointer.container
		? world.get(pointer.entityId, Components[pointer.container])!.items
		: world.get(pointer.entityId, Components.Items)!.items;

	for (const item of itemContainer) {
		if (item.guid === guid) {
			return item as Item<P>;
		}
	}

	return undefined;
}

/**
 * Retrieves an item by its ID path from a specific location (hotbar or inventory).
 *
 * @template P
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity in the world.
 * @param location - The location ("Hotbar" or "Inventory").
 * @param id - The item's ID path.
 * @returns The item if found, undefined otherwise.
 */
export function getItemFromId<P extends ValidItemPath>(
	world: World,
	entityId: AnyEntity,
	location: "Hotbar" | "Inventory",
	id: P,
): N<Item<P>> {
	const component = world.get(entityId, Components[location]) as ItemContainer;

	/*
	 * Compare by explicit index against a concretely-typed `Item`: reading `item.id[index]` directly
	 * inside the generic signature makes rbxtsc emit a 0-based table read, which never matches.
	 */
	return component.items.find((item) => {
		const itemId: ReadonlyArray<string> = item.id;
		return id.every((key, index) => itemId[index] === key);
	}) as Item<P>;
}

/**
 * Retrieves an item by its GUID and ID path from an array of items.
 *
 * @template P, U
 * @param world - The Matter world instance.
 * @param guid - The GUID of the item.
 * @param id - The ID path of the item.
 * @param items - The array of items to search.
 * @param _excludeParent - If true, excludes the parent ID from the type returned (has no effect on
 *   runtime).
 * @returns The matching item, or undefined if not found.
 */
export function getItemWithIdFromGUID<P extends ValidItemPath, U extends N<boolean>>(
	_world: World,
	guid: N<string>,
	id: P,
	items: Array<Item>,
	_excludeParent?: U,
): N<Item<ItemHierarchyIds<P, U>>> {
	if (guid === undefined || id[0] === undefined) {
		return undefined;
	}

	return items.find((item): item is Item<ItemHierarchyIds<P, U>> => {
		return item.guid === guid && id.every((key, index) => item.id[index] === key);
	});
}
/**
 * Moves an item between an entity's inventory and hotbar, or from another entity's inventory.
 * Handles cleanup and 'Moved' status for inter-entity transfers.
 *
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity in the world.
 * @param guid - The GUID of the item to move.
 * @param destination - The destination container ("Hotbar" or "Inventory").
 */
export function moveItem(
	world: World,
	entityId: AnyEntity,
	guid: string,
	destination: "Hotbar" | "Inventory",
): void {
	let [inventory, hotbar] = world.get(entityId, Components.Inventory, Components.Hotbar) as [
		Component<Components["Inventory"]>,
		Component<Components["Hotbar"]>,
	];

	const item = getItemFromGUID(world, guid)!;
	const itemPointers = store.shared.getState("itemPointers");
	const entityIdForGuid = itemEntityId(itemPointers[guid]);
	if (entityIdForGuid === undefined) {
		return;
	}

	if (entityIdForGuid !== entityId) {
		const items = world.get(entityIdForGuid, Components.Items);
		const itemContainer = destination === "Inventory" ? inventory : hotbar;

		if (!items) {
			return;
		}

		// Mark as moved and transfer to the new entity. Clean up the old entity afterwards.
		world.insert(entityIdForGuid, items.patch({ moved: true }));
		world.insert(entityId, itemContainer!.patch({ items: [...itemContainer!.items, item] }));

		// Use task.delay instead of task.defer so it can be mocked in tests
		task.delay(0, () => {
			world.despawn(entityIdForGuid);
		});

		return;
	}

	// Handle intra-entity transfer (between hotbar and inventory).
	world.insert(
		entityId,
		inventory!.patch({
			items:
				destination === "Inventory"
					? [...inventory!.items, item]
					: removeValue(inventory!.items, item),
		}),
		hotbar!.patch({
			items:
				destination === "Hotbar"
					? [...hotbar!.items, item]
					: removeValue(hotbar!.items, item),
		}),
	);
}
/**
 * Removes an item by GUID, optionally specifying the amount to remove.
 *
 * @param world - The Matter world instance.
 * @param guid - The GUID of the item to remove.
 * @param amount - The amount to remove (defaults to the item's full amount).
 * @returns The removed item object, or undefined if not found.
 */
export function removeItem(world: World, guid: string, amount?: number): N<Item> {
	const itemPointers = store.shared.getState("itemPointers");
	const pointer = parseItemPointer(itemPointers[guid]);
	if (pointer === undefined) {
		return undefined;
	}

	const { container: location, entityId } = pointer;

	let removedItem: N<Item>;

	const removeItemFromContainer = (component: ItemContainer, targetItem: Item): void => {
		const amountToRemove =
			amount !== undefined ? math.min(amount, targetItem.amount) : targetItem.amount;
		let newItems = component.items;

		if (amountToRemove === targetItem.amount) {
			newItems = newItems.filter((item) => item.guid !== guid);
			removedItem = targetItem;
		} else {
			newItems = newItems.map((item) => {
				return item.guid === guid
					? { ...item, amount: item.amount - amountToRemove }
					: item;
			});
			removedItem = {
				...targetItem,
				amount: amountToRemove,
				guid: HttpService.GenerateGUID(false),
			};
		}

		world.insert(
			entityId,
			component.patch({
				items: newItems,
			}),
		);
	};

	if (location) {
		const component: ItemContainer = world.get(entityId, Components[location])!;
		const targetItem = component.items.find((item) => item.guid === guid);

		if (targetItem) {
			removeItemFromContainer(component, targetItem);
		}
	} else {
		const component: ItemContainer = world.get(entityId, Components.Items)!;
		const [targetItem] = component.items;

		if (targetItem) {
			if (amount !== undefined && amount < targetItem.amount) {
				removeItemFromContainer(component, targetItem);
			} else {
				world.despawn(entityId);
				removedItem = targetItem;
			}
		}
	}

	if (removedItem?.tool) {
		removedItem.tool.Parent = undefined;
	}

	return removedItem;
}

/**
 * Sets data for a specific item within an entity's item component.
 *
 * @template T
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity in the world.
 * @param component - The item component.
 * @param itemToSet - The item to modify.
 * @param data - The new data to set on the item.
 * @returns The updated item.
 */
export function setItemData<T extends Item>(
	world: World,
	entityId: AnyEntity,
	component: ItemContainer,
	itemToSet: T,
	data: Partial<T["data"]>,
): Item<T["id"]> {
	const newItem = {
		...itemToSet,
		data: { ...itemToSet.data, ...data },
	};

	const index = component.items.findIndex((item) => item.guid === itemToSet.guid);
	const newItems = [...component.items];
	newItems[index] = newItem;

	world.insert(
		entityId,
		component.patch({
			items: newItems,
		}),
	);

	return newItem;
}
/**
 * Spawns an item into the workspace.
 *
 * @template P
 * @param world - The Matter world instance.
 * @param item - The item to spawn.
 * @param cf - The CFrame to spawn the item at.
 * @returns The entity ID of the spawned item.
 */
export function spawnItem<P extends ValidItemPath>(
	world: World,
	item: Item<P>,
	cf: CFrame,
): AnyEntity {
	const model = getItemModel(item.id)?.Clone();

	if (!model) {
		throw new Error(Log.Error("spawnItem(): Model not found"));
	}

	const entityId = world.spawn(
		Components.Items({
			items: [item],
			model,
		}),
		Components.Stream({
			container: Workspace.Items,
			value: "out",
		}),
	);

	model.PivotTo(cf);
	model.SetAttribute("serverEntityId", entityId);

	model.Name = item.guid;
	model.Parent = Workspace.Items;

	return entityId;
}
/**
 * Finds the nearest item matching a target item ID within the world.
 *
 * Iterates through all entities with an `Items` component and returns the closest one that matches
 * the target item ID, excluding items that have been moved or are already known.
 *
 * @param world - The Matter world instance to query.
 * @param targetItemId - The item ID path to search for.
 * @param gameObject - The model to measure distance from.
 * @param knownPoints - Optional map of entity IDs to positions that should be excluded from the
 *   search.
 * @returns The nearest matching item with its entity ID, magnitude (distance), and position, or
 *   `undefined` if none found.
 */
export function findNearestItem(
	world: World,
	targetItemId: ReadonlyArray<string>,
	gameObject: Model,
	knownPoints?: Record<AnyEntity, Vector3>,
):
	| undefined
	| {
			entityId: AnyEntity;
			magnitude: number;
			position: Vector3;
	  } {
	let nearestItem:
		| undefined
		| {
				entityId: AnyEntity;
				magnitude: number;
				position: Vector3;
		  };

	for (const [entityId, { items, model, moved }] of world.query(Components.Items)) {
		if (
			moved === true ||
			!targetItemId.every((key, index) => items[0]?.id[index] === key) ||
			(knownPoints !== undefined && entityId in knownPoints)
		) {
			continue;
		}

		const position = model.GetPivot().Position;
		const magnitude = gameObject.GetPivot().Position.sub(position).Magnitude;

		if (!nearestItem || magnitude < nearestItem.magnitude) {
			nearestItem = { entityId, magnitude, position };
		}
	}

	return nearestItem;
}

/**
 * Retrieves the equipped item from an entity's hotbar that matches a specific item ID.
 *
 * @param world - The Matter world instance.
 * @param entityId - The ID of the entity to query.
 * @param id - The item ID path to match against the equipped item.
 * @returns The matching equipped `Item`, or `undefined` if no item is equipped or no match is
 *   found.
 */
export function getEquippedItemWithId(
	world: World,
	entityId: AnyEntity,
	id: ReadonlyArray<string>,
): Item | undefined {
	const hotbar = world.contains(entityId) ? world.get(entityId, Components.Hotbar) : undefined;

	const equippedGuid = hotbar?.equipped;
	if (!equippedGuid) {
		return undefined;
	}

	return hotbar.items.find(
		(item: Item) =>
			item.guid === equippedGuid && id.every((key, index) => item.id[index] === key),
	);
}
