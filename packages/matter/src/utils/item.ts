import { store } from "@lisachandra/core/store";
import type { AnyEntity } from "@rbxts/matter";

import type { Item } from "../components";
import type { ValidItemPath } from "../items/definitions";
import type { ItemContainer, ItemHierarchyIds } from "../items/types";
import * as Lookup from "./item/lookup";
import * as State from "./item/state";

/** @deprecated Use `import { getCompleteItem } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getCompleteItem } = Lookup;

/** @deprecated Use `import { getNumericItemIdFromId } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getNumericItemIdFromId } = Lookup;

/** @deprecated Use `import { getItemIdFromNumericId } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemIdFromNumericId } = Lookup;

/**
 * @deprecated Use `import { getItemDescriptionContainer } from
 *   "@lisachandra/matter/utils/item/lookup"`.
 */
export const { getItemDescriptionContainer } = Lookup;

/** @deprecated Use `import { getItemModelContainer } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemModelContainer } = Lookup;

/** @deprecated Use `import { getItemToolContainer } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemToolContainer } = Lookup;

/**
 * @deprecated Use `import { getItemToolAnimationContainer } from
 *   "@lisachandra/matter/utils/item/lookup"`.
 */
export const { getItemToolAnimationContainer } = Lookup;

/** @deprecated Use `import { getItemConfig } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemConfig } = Lookup;

/** @deprecated Use `import { getItemToolAnimation } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemToolAnimation } = Lookup;

/** @deprecated Use `import { getItemModel } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemModel } = Lookup;

/** @deprecated Use `import { getItemTool } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemTool } = Lookup;

/** @deprecated Use `import { createItem } from "@lisachandra/matter/utils/item/lookup"`. */
export const { createItem } = Lookup;

/** @deprecated Use `import { getItemDescription } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemDescription } = Lookup;

/** @deprecated Use `import { getItemFromId } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemFromId } = Lookup;

/** @deprecated Use `import { getItemImage } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemImage } = Lookup;

/** @deprecated Use `import { getItemName } from "@lisachandra/matter/utils/item/lookup"`. */
export const { getItemName } = Lookup;

/** @deprecated Use `import { isSameId } from "@lisachandra/matter/utils/item/lookup"`. */
export const { isSameId } = Lookup;
/** @deprecated Use `import { addItem } from "@lisachandra/matter/utils/item/state"` passing `world`. */
export function addItem<P extends ValidItemPath>(
	entityId: AnyEntity,
	location: "Hotbar" | "Inventory",
	itemToAdd: Item<P>,
): void {
	State.addItem(store.world, entityId, location, itemToAdd);
}

/**
 * @deprecated Use `import { getItemFromGUID } from "@lisachandra/matter/utils/item/state"` passing
 *   `world`.
 */
export function getItemFromGUID<P extends ValidItemPath>(guid: string): N<Item<P>> {
	return State.getItemFromGUID(store.world, guid);
}

/**
 * @deprecated Use `import { getItemWithIdFromGUID } from "@lisachandra/matter/utils/item/state"`
 *   passing `world`.
 */
export function getItemWithIdFromGUID<P extends ValidItemPath, U extends N<boolean>>(
	guid: N<string>,
	id: P,
	items: Array<Item>,
	excludeParent?: U,
): N<Item<ItemHierarchyIds<P, U>>> {
	return State.getItemWithIdFromGUID(store.world, guid, id, items, excludeParent);
}

/**
 * @deprecated Use `import { moveItem } from "@lisachandra/matter/utils/item/state"` passing
 *   `world`.
 */
export function moveItem(
	entityId: AnyEntity,
	guid: string,
	destination: "Hotbar" | "Inventory",
): void {
	State.moveItem(store.world, entityId, guid, destination);
}

/**
 * @deprecated Use `import { removeItem } from "@lisachandra/matter/utils/item/state"` passing
 *   `world`.
 */
export function removeItem(guid: string, amount?: number): N<Item> {
	return State.removeItem(store.world, guid, amount);
}

/**
 * @deprecated Use `import { setItemData } from "@lisachandra/matter/utils/item/state"` passing
 *   `world`.
 */
export function setItemData<T extends Item>(
	entityId: AnyEntity,
	component: ItemContainer,
	itemToSet: T,
	data: Partial<T["data"]>,
): Item<T["id"]> {
	return State.setItemData(store.world, entityId, component, itemToSet, data);
}

/**
 * @deprecated Use `import { spawnItem } from "@lisachandra/matter/utils/item/state"` passing
 *   `world`.
 */
export function spawnItem<P extends ValidItemPath>(item: Item<P>, cf: CFrame): AnyEntity {
	return State.spawnItem(store.world, item, cf);
}

/** @deprecated Use `import { findNearestItem } from "@lisachandra/matter/utils/item/state"`. */
export const { findNearestItem } = State;

/** @deprecated Use `import { getEquippedItemWithId } from "@lisachandra/matter/utils/item/state"`. */
export const { getEquippedItemWithId } = State;
