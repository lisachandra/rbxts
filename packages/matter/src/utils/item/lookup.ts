import { store } from "@lisachandra/core/store";
import { isPascalCase } from "@lisachandra/core/utils/string";
import { iterate } from "@lisachandra/core/utils/type";
import type { AnyEntity } from "@rbxts/matter";
import { HttpService, ReplicatedStorage } from "@rbxts/services";
import { equals } from "@rbxts/sift/Array";
import { copyDeep, removeKeys } from "@rbxts/sift/Dictionary";

import type { Item } from "../../components";
import { Components } from "../../components";
import type { ValidItemPath } from "../../items/definitions";
import { itemDefinitions } from "../../items/definitions";
import { descriptions } from "../../items/descriptions";
import { itemIds } from "../../items/registry";
import type { ExtractData, ItemContainer } from "../../items/types";

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
 * Retrieves an instance from a nested hierarchy of instances using a path of names.
 *
 * @template T
 * @param root - The root instance.
 * @param strict - If true, returns undefined if any part of the path is not found.
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
export function getCompleteItem<P extends ValidItemPath>(id: P): Item<P>["data"] {
	let data: Table = itemDefinitions;

	for (const path of id) {
		data = { ...data, ...(data[path] as Table) };
	}

	const keysToRemove = [];
	for (const [key] of iterate(data)) {
		if (isPascalCase(key as string)) {
			keysToRemove.push(key);
		}
	}

	return copyDeep(removeKeys(data, ...keysToRemove)) as Item<P>["data"];
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
 * Creates a new item object.
 *
 * @template P
 * @param id - The item's ID path.
 * @param partialData - Partial data to override default item data.
 * @param mergeSuper - If false, will not merge with default data from `getCompleteItem`.
 * @returns The newly created item object.
 */
export function createItem<P extends ValidItemPath>(
	id: P,
	partialData: Partial<Item<P>["data"]>,
	mergeSuper = true,
): Item<P> {
	const data = (
		mergeSuper ? { ...getCompleteItem(id), ...partialData } : partialData
	) as Item<P>["data"];

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
	const descriptionContainer = getItemDescriptionContainer(paths) as
		| undefined
		| { description?: string };
	return descriptionContainer?.description ?? "";
}

/**
 * Retrieves an item by its ID path from a specific location (hotbar or inventory).
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
): N<Item<P>> {
	const component = store.world.get(entityId, Components[location]) as ItemContainer;
	return component.items.find((item) =>
		id.every((key, index) => item.id[index] === key),
	) as Item<P>;
}

/**
 * Retrieves the image URL of an item.
 *
 * @param paths - The path to the item in the descriptions table.
 * @returns The item image URL.
 */
export function getItemImage(paths: ValidItemPath): string {
	const descriptionContainer = getItemDescriptionContainer(paths) as
		| undefined
		| { image?: string };
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
 * Checks if all provided items have the same ID.
 *
 * @param ids - An array of item ids to compare.
 * @returns True if all items have the same ID, false otherwise.
 */
export function isSameId(...ids: Array<Item["id"]>): boolean {
	return ids.every(
		(id) => ids[0]!.size() === id.size() && ids[0]!.every((key, index) => id[index] === key),
	);
}
