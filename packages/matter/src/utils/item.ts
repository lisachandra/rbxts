import Log from "@rbxts/log";
import { Error } from "@rbxts/luau-polyfill";
import type { AnyEntity, Component, World } from "@rbxts/matter";
import { HttpService, ReplicatedStorage, Workspace } from "@rbxts/services";
import { removeValue } from "@rbxts/sift/out/Array";

import type { ExtractData, ItemContainer, ItemHierarchyIds } from "../items/types";
import type { ValidItemPath } from "../items/definitions";
import { descriptions } from "../items/descriptions";
import { itemDefinitions } from "../items/definitions";
import { itemIds } from "../items/registry";
import { Components } from "../components";
import { store } from "@lisachandra/core/out/store";

import { equals } from "@rbxts/sift/out/Array";
import { copyDeep, removeKeys } from "@rbxts/sift/out/Dictionary";

import { isPascalCase } from "@lisachandra/core/out/utils/string";
import { iterate } from "@lisachandra/core/out/utils/type";


/**
 * Retrieves a value from a nested table using a path of keys.
 *
 * @template T
 * @param root - The root table.
 * @returns A function that takes a path and returns the value at that path.
 */
function getValueFromPaths<T extends Table>(root: T) {
	return <P extends ValidItemPath>(paths: P): ExtractData<T, P, true> => {
		let config: Table = root;

		for (const path of paths) {
			config = config[path] as Table;
		}

		return config as ExtractData<T, P, true>;
	};
}

/**
 * Retrieves an instance from a nested hierarchy of instances using a path of
 * names.
 *
 * @template T
 * @param root - The root instance.
 * @param strict - If true, returns undefined if any part of the path is not
 *   found.
 * @returns A function that takes a path and returns the instance at that path.
 */
function getInstanceFromPaths<T extends Instance>(root: T, strict = false) {
	return (paths: ValidItemPath): N<T> => {
		let model: N<Instance> = root;

		for (const path of paths) {
			model = model?.FindFirstChild(path) ?? (strict ? undefined : model);
		}

		return model as N<T>;
	};
}

const itemDescriptionContainer = getValueFromPaths(descriptions);
const itemModelContainer = getInstanceFromPaths(
	ReplicatedStorage.Models.Items as Instance as Model,
	true,
);
const itemToolContainer = getInstanceFromPaths(ReplicatedStorage.Tools as Instance as Tool, true);
const itemToolAnimationContainer = getInstanceFromPaths(
	ReplicatedStorage.Animations.Tools as Instance as Animation,
);
const itemConfig = getValueFromPaths(itemDefinitions);

/**
 * Retrieves the complete data for an item given its path.
 *
 * @template P
 * @param id - The path to the item.
 * @returns The item data.
 */
export function getCompleteItem<P extends ValidItemPath>(id: P): Components.Item<P>["data"] {
	let data: Table = itemDefinitions as never;

	for (const path of id) {
		data = { ...data, ...(data[path] as Table) };
	}

	const keysToRemove = [];
	for (const [key] of iterate(data)) {
		if (isPascalCase(key as string)) {
			keysToRemove.push(key);
		}
	}

	return copyDeep(removeKeys(data, ...keysToRemove)) as Components.Item<P>["data"];
}

/**
 * Retrieves the numeric ID for an item given its path.
 *
 * @param id - The path to the item.
 * @returns The numeric ID of the item.
 */
export function getNumericItemIdFromId(id: ValidItemPath): N<number> {
	let numericId: N<number>;

	for (const [key, value] of itemIds) {
		numericId = equals(key, id) ? value : numericId;
	}

	return numericId;
}

/**
 * Retrieves the item path given its numeric ID.
 *
 * @param numericId - The numeric ID of the item.
 * @returns The path to the item.
 */
export function getItemIdFromNumericId(numericId: number): N<ValidItemPath> {
	let id: N<ValidItemPath>;

	for (const [key, value] of itemIds) {
		id = value === numericId ? key : id;
	}

	return id;
}

/** Retrieves the container for an item description. */
export function getItemDescriptionContainer<P extends ValidItemPath>(
	paths: P,
): ExtractData<typeof descriptions, P, true> {
	return itemDescriptionContainer(paths);
}

/** Retrieves an item model container of an item. */
export function getItemModelContainer(paths: ValidItemPath): N<Model> {
	return itemModelContainer(paths);
}

/** Retrieves an item tool container of an item. */
export function getItemToolContainer(paths: ValidItemPath): N<Tool> {
	return itemToolContainer(paths);
}

/** Retrieves an item tool animation container of an item. */
export function getItemToolAnimationContainer(paths: ValidItemPath): N<Animation> {
	return itemToolAnimationContainer(paths);
}

/** Retrieves configuration for an item. */
export function getItemConfig<P extends ValidItemPath>(
	paths: P,
): ExtractData<typeof itemDefinitions, P, true> {
	return itemConfig(paths);
}

/**
 * Retrieves the tool animation of an item.
 *
 * @param paths - The path to the item tool animation.
 * @returns The item tool animation, or undefined if not found.
 */
export function getItemToolAnimation(paths: ValidItemPath): N<Animation> {
	return getItemToolAnimationContainer(paths)?.FindFirstChild<Animation>("Animation");
}

/**
 * Retrieves the model of an item.
 *
 * @param paths - The path to the item model.
 * @returns The item model, or undefined if not found.
 */
export function getItemModel(paths: ValidItemPath): N<Model> {
	return getItemModelContainer(paths)?.FindFirstChild<Model>("Model");
}

/**
 * Retrieves the tool of an item.
 *
 * @param paths - The path to the item tool.
 * @returns The item tool, or undefined if not found.
 */
export function getItemTool(paths: ValidItemPath): N<Tool> {
	return getItemToolContainer(paths)?.FindFirstChild<Tool>("Tool");
}

/**
 * Adds an item to either the hotbar or inventory. If an item with the same
 * ID exists, it increments the amount.
 *
 * @template P
 * @param entityId - The ID of the entity in the world.
 * @param location - The location to add the item to ("Hotbar" or
 *   "Inventory").
 * @param itemToAdd - The item to add.
 */
export function addItem<P extends ValidItemPath>(
	entityId: AnyEntity,
	location: "Hotbar" | "Inventory",
	itemToAdd: Components.Item<P>,
): void {
	const component = store.world.get(entityId, Components[location])! as ItemContainer;

	for (const item of component.items) {
		if (!isSameId(item.id, itemToAdd.id)) {
			continue;
		}

		store.world.insert(
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

		// eslint-disable-next-line @kapouer/no-return-in-loop/no-return-in-loop -- Intended return
		return;
	}

	store.world.insert(
		entityId,
		component.patch({
			items: [...component.items, itemToAdd],
		}),
	);
}

/**
 * Creates a new item object.
 *
 * @template P
 * @param id - The item's ID path.
 * @param partialData - Partial data to override default item data.
 * @param mergeSuper - If false, will not merge with default data from
 *   `getCompleteItem`.
 * @returns The newly created item object.
 */
export function createItem<P extends ValidItemPath>(
	id: P,
	partialData: Partial<Components.Item<P>["data"]>,
	mergeSuper = true,
): Components.Item<P> {
	const data = (
		mergeSuper ? { ...getCompleteItem(id), ...partialData } : partialData
	) as Components.Item<P>["data"];

	return {
		amount: 1,
		data,
		guid: HttpService.GenerateGUID(false),
		id,
	};
}

/**
 * Retrieves the description of an item.
 *
 * @param paths - The path to the item in the descriptions table.
 * @returns The item description.
 */
export function getItemDescription(paths: ValidItemPath): string {
	const descriptionContainer = getItemDescriptionContainer(paths) as { description?: string } | undefined;
	return descriptionContainer?.description ?? "";
}

/**
 * Retrieves an item by its GUID.
 *
 * @template P
 * @param guid - The GUID of the item.
 * @returns The matching item, or undefined if not found.
 */
export function getItemFromGUID<P extends ValidItemPath>(
	guid: string,
): N<Components.Item<P>> {
	const itemPointers = store.shared.getState("itemPointers");

	if (itemPointers[guid] === undefined) {
		return;
	}

	const [entityIdStr, location] = itemPointers[guid].split("_") as [
		string,
		N<"Hotbar" | "Inventory">,
	];
	const entityId = tonumber(entityIdStr) as N<AnyEntity>;

	if (entityId === undefined || !store.world.contains(entityId)) {
		return;
	}

	const itemContainer = location
		? store.world.get(entityId, Components[location])!.items
		: store.world.get(entityId, Components.Items)!.items;

	for (const item of itemContainer) {
		if (item.guid === guid) {
			return item as Components.Item<P>;
		}
	}

	return undefined;
}

/**
 * Retrieves an item by its ID path from a specific location (hotbar or
 * inventory).
 *
 * @template P
 * @param entityId - The ID of the entity in the world.
 * @param location - The location ("Hotbar" or "Inventory").
 * @param id - The item's ID path.
 * @returns The item if found, undefined otherwise.
 */
export function getItemFromId<P extends ValidItemPath>(
	entityId: AnyEntity,
	location: "Hotbar" | "Inventory",
	id: P,
): N<Components.Item<P>> {
	const component = store.world.get(entityId, Components[location]) as ItemContainer;
	return component.items.find((item) =>
		id.every((key, index) => item.id[index] === key),
	) as Components.Item<P>;
}

/**
 * Retrieves the image URL of an item.
 *
 * @param paths - The path to the item in the descriptions table.
 * @returns The item image URL.
 */
export function getItemImage(paths: ValidItemPath): string {
	const descriptionContainer = getItemDescriptionContainer(paths) as { image?: string } | undefined;
	return descriptionContainer?.image ?? "";
}

/**
 * Gets the name of the item from its ID path.
 *
 * @param id - The item's ID path.
 * @returns The name of the item.
 */
export function getItemName(id: ValidItemPath): string {
	return id[id.size() - 1]!;
}

/**
 * Retrieves an item by its GUID and ID path from an array of items.
 *
 * @template P, U
 * @param guid - The GUID of the item.
 * @param id - The ID path of the item.
 * @param items - The array of items to search.
 * @param _excludeParent - If true, excludes the parent ID from the type
 *   returned (has no effect on runtime).
 * @returns The matching item, or undefined if not found.
 */
export function getItemWithIdFromGUID<P extends ValidItemPath, U extends N<boolean>>(
	guid: N<string>,
	id: P,
	items: Array<Components.Item>,
	_excludeParent?: U,
): N<Components.Item<ItemHierarchyIds<P, U>>> {
	if (guid === undefined || id[0] === undefined) {
		return undefined;
	}

	return items.find((item): item is Components.Item<ItemHierarchyIds<P, U>> => {
		return item.guid === guid && id.every((key, index) => item.id[index] === key);
	});
}

/**
 * Checks if all provided items have the same ID.
 *
 * @param ids - An array of item ids to compare.
 * @returns True if all items have the same ID, false otherwise.
 */
export function isSameId(...ids: Array<Components.Item["id"]>): boolean {
	return ids.every(
		(id) => ids[0]!.size() === id.size() && ids[0]!.every((key, index) => id[index] === key),
	);
}

/**
 * Moves an item between an entity's inventory and hotbar, or from another
 * entity's inventory. Handles cleanup and 'Moved' status for inter-entity
 * transfers.
 *
 * @param entityId - The ID of the entity in the world.
 * @param guid - The GUID of the item to move.
 * @param destination - The destination container ("Hotbar" or "Inventory").
 */
export function moveItem(
	entityId: AnyEntity,
	guid: string,
	destination: "Hotbar" | "Inventory",
): void {
	let [inventory, hotbar] = store.world.get(entityId, Components.Inventory, Components.Hotbar);

	// TEST: Jest doesn't support tuples
	if (_G.__TEST__ ?? false) {
		[inventory, hotbar] = inventory as never as [
			Component<Components.Inventory>,
			Component<Components.Hotbar>,
		];
	}

	const item = getItemFromGUID(guid)!;
	const itemPointers = store.shared.getState("itemPointers");
	const [itemEntityIdStr] = itemPointers[guid]!.split("_");
	const itemEntityId = tonumber(itemEntityIdStr) as AnyEntity;

	if (itemEntityId !== entityId) {
		const items = store.world.get(itemEntityId, Components.Items);
		const itemContainer = destination === "Inventory" ? inventory : hotbar;

		if (!items) {
			return;
		}

		// Mark as moved and transfer to the new entity. Clean up the old entity afterwards.
		store.world.insert(itemEntityId, items.patch({ moved: true }));
		store.world.insert(entityId, itemContainer!.patch({ items: [...itemContainer!.items, item] }));

		// Use task.delay instead of task.defer so it can be mocked in tests
		task.delay(0, () => {
			store.world.despawn(itemEntityId);
		});

		return;
	}

	// Handle intra-entity transfer (between hotbar and inventory).
	store.world.insert(
		entityId,
		inventory!.patch({
			items:
				destination === "Inventory"
					? [...inventory!.items, item]
					: removeValue(inventory!.items, item),
		}),
		hotbar!.patch({
			items:
				destination === "Hotbar" ? [...hotbar!.items, item] : removeValue(hotbar!.items, item),
		}),
	);
}

/**
 * Removes an item by GUID, optionally specifying the amount to remove.
 *
 * @param guid - The GUID of the item to remove.
 * @param amount - The amount to remove (defaults to the item's full
 *   amount).
 * @returns The removed item object, or undefined if not found.
 */
export function removeItem(guid: string, amount?: number): N<Components.Item> {
	const itemPointers = store.shared.getState("itemPointers");
	const [entityIdStr, location] = itemPointers[guid]!.split("_") as [
		string,
		N<"Hotbar" | "Inventory">,
	];
	const entityId = tonumber(entityIdStr) as AnyEntity;

	let removedItem: N<Components.Item>;

	const removeItemFromContainer = (component: ItemContainer, targetItem: Components.Item): void => {
		const amountToRemove = amount !== undefined ? math.min(amount, targetItem.amount) : targetItem.amount;
		let newItems = component.items;

		if (amountToRemove === targetItem.amount) {
			newItems = newItems.filter((item) => item.guid !== guid);
			removedItem = targetItem;
		} else {
			newItems = newItems.map((item) => {
				return item.guid === guid ? { ...item, amount: item.amount - amountToRemove } : item;
			});
			removedItem = {
				...targetItem,
				amount: amountToRemove,
				guid: HttpService.GenerateGUID(false),
			};
		}

		store.world.insert(
			entityId,
			component.patch({
				items: newItems,
			}),
		);
	};

	if (location) {
		const component: ItemContainer = store.world.get(entityId, Components[location])!;
		const targetItem = component.items.find((item) => item.guid === guid);

		if (targetItem) {
			removeItemFromContainer(component, targetItem);
		}
	} else {
		const component: ItemContainer = store.world.get(entityId, Components.Items)!;
		const [targetItem] = component.items;

		if (targetItem) {
			if (amount !== undefined && amount < targetItem.amount) {
				removeItemFromContainer(component, targetItem);
			} else {
				store.world.despawn(entityId);
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
 * @param entityId - The ID of the entity in the world.
 * @param component - The item component.
 * @param itemToSet - The item to modify.
 * @param data - The new data to set on the item.
 * @returns The updated item.
 */
export function setItemData<T extends Components.Item>(
	entityId: AnyEntity,
	component: ItemContainer,
	itemToSet: T,
	data: Partial<T["data"]>,
): Components.Item<T["id"]> {
	const newItem = {
		...itemToSet,
		data: { ...itemToSet.data, ...data },
	};

	const index = component.items.findIndex((item) => item.guid === itemToSet.guid);
	const newItems = [...component.items];
	newItems[index] = newItem;

	store.world.insert(
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
 * @param item - The item to spawn.
 * @param cf - The CFrame to spawn the item at.
 * @returns The entity ID of the spawned item.
 */
export function spawnItem<P extends ValidItemPath>(
	item: Components.Item<P>,
	cf: CFrame,
): AnyEntity {
	const model = getItemModel(item.id)?.Clone();

	if (!model) {
		throw new Error(Log.Error("spawnItem(): Model not found"));
	}

	const entityId = store.world.spawn(
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

export function findNearestItem(
	world: World,
	targetItemId: ReadonlyArray<string>,
	gameObject: Model,
	knownPoints?: Record<AnyEntity, Vector3>,
): {
	entityId: AnyEntity;
	magnitude: number;
	position: Vector3;
} | undefined {
	let nearestItem: {
		entityId: AnyEntity;
		magnitude: number;
		position: Vector3;
	} | undefined;

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

export function getEquippedItemWithId(
	world: World,
	entityId: AnyEntity,
	id: ReadonlyArray<string>,
): Components.Item | undefined {
	const hotbar = world.contains(entityId) ? world.get(entityId, Components.Hotbar) : undefined;

	const equippedGuid = hotbar?.equipped;
	if (!equippedGuid) {
		return undefined;
	}

	return hotbar.items.find(
		(item: Components.Item) => item.guid === equippedGuid && id.every((key, index) => item.id[index] === key),
	);
}
