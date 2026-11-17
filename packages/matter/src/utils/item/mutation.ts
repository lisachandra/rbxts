import type { AnyEntity, World } from "@rbxts/matter";
import { filter } from "@rbxts/sift/Dictionary";

import type { ChangeRecord, Item } from "../../components";
import { Components, isComponent } from "../../components";
import type { ItemContainer } from "../../items/types";
import type { ItemContainerLocation } from "../itemPointer";
import { parseItemPointer } from "../itemPointer";

/**
 * A component that stores items: a ground entity's `Items`, or an entity's `Hotbar` / `Inventory`.
 *
 * @remarks
 *   This is the set of components whose removal invalidates item pointers, so it is also the set a
 *   {@link cleanItemPointers} change record may carry.
 */
export type ItemRelatedComponent =
	| Components["Items"]
	| Components["Hotbar"]
	| Components["Inventory"];

/**
 * An item together with the entity that holds it.
 *
 * @remarks
 *   `getHeldItem` answers "does this entity still hold this item?" in one place: a live pointer is
 *   not evidence that the item exists, because a pointer can outlive the item it names.
 */
export interface HeldItem {
	/** The container the item sits in, or `undefined` when the item is on the ground. */
	container?: ItemContainerLocation;
	/** The entity that holds the item. */
	entityId: AnyEntity;
	/** The item as stored in the container. */
	item: Item;
}

/** Why a drop request was refused. */
export type DropRejection = "amount" | "not-owner" | "missing-item";

/** The lowest `amount` an item message may request. */
export const MINIMUM_ITEM_AMOUNT = 1;

/**
 * Decides whether a requested item amount is legal.
 *
 * @remarks
 *   `MessageData` declares `amount` as a Serio `u16`, so a value read off the wire is already
 *   integral and non-negative; the floor of {@link MINIMUM_ITEM_AMOUNT} is the gap that mattered.
 *   `0` used to survive `math.min(0, stack)`, leave the stack intact, and mint a zero-amount item
 *   under a fresh GUID — one burned GUID and one live ground entity per packet, until the 16-bit
 *   GUID space was exhausted and replication halted on `Log.Fatal`. `NaN` fails the comparison too,
 *   so this stays total for callers that are not on the wire.
 * @param amount - The requested amount.
 * @returns `true` when the amount is at least {@link MINIMUM_ITEM_AMOUNT}.
 */
export function isValidItemAmount(amount: number): boolean {
	return amount >= MINIMUM_ITEM_AMOUNT;
}

/**
 * Resolves the item a pointer names and reports whether the pointer's entity still holds it.
 *
 * @remarks
 *   Every input is an argument — world, pointer map, GUID — so "does the owner still hold this?"
 *   has one implementation and can be exercised without a running system. Returns `undefined` when
 *   the pointer is missing or malformed, its entity is gone, the pointer names a container the
 *   entity no longer has, or that container no longer holds an item with this GUID.
 * @param world - The Matter world.
 * @param itemPointers - The GUID → pointer map to resolve against.
 * @param guid - The item GUID.
 * @returns The held item, or `undefined` when the pointer does not lead to one.
 */
export function getHeldItem(
	world: World,
	itemPointers: Record<string, string>,
	guid: string,
): N<HeldItem> {
	const pointer = parseItemPointer(itemPointers[guid]);
	if (pointer === undefined || !world.contains(pointer.entityId)) {
		return undefined;
	}

	const component = getItemContainer(world, pointer.entityId, pointer.container);
	const item = component?.items.find((candidate) => candidate.guid === guid);

	if (item === undefined) {
		return undefined;
	}

	return { container: pointer.container, entityId: pointer.entityId, item };
}

/**
 * Classifies a drop request before any mutation runs.
 *
 * @remarks
 *   The bounds and the ownership check share this one entry point, so a new item message cannot
 *   skip either by re-implementing the shape. The caller logs the returned reason and returns;
 *   nothing here mutates, so a rejected request leaves item state and the GUID space untouched.
 * @param world - The Matter world.
 * @param itemPointers - The GUID → pointer map before this request.
 * @param actorEntityId - The entity that claims to hold the item.
 * @param guid - The item GUID to drop.
 * @param amount - How many to drop.
 * @returns The rejection reason, or `undefined` when the request may proceed.
 */
export function validateDropRequest(
	world: World,
	itemPointers: Record<string, string>,
	actorEntityId: AnyEntity,
	guid: string,
	amount: number,
): N<DropRejection> {
	if (!isValidItemAmount(amount)) {
		return "amount";
	}

	const held = getHeldItem(world, itemPointers, guid);

	if (held === undefined) {
		return "missing-item";
	}

	if (held.entityId !== actorEntityId) {
		return "not-owner";
	}

	return undefined;
}

/**
 * Drops the pointers that name an item a removed component no longer holds.
 *
 * @remarks
 *   The previous predicate — `record.old.items.some((item) => key !== item.guid)` — asked whether
 *   _some_ held item differed from the key, which is true for every key as soon as the component
 *   held two items. Nothing was ever cleaned, so pointers outlived their items, and a surviving
 *   pointer is what let the move path dereference `undefined` and abort the dispatch tick for every
 *   player. A ground entity whose items were moved carries `moved`; its pointers stay valid because
 *   the receiving component's change record re-points them. Its model is destroyed either way.
 * @param record - The change record for the removed component.
 * @param itemPointers - The GUID → pointer map to clean.
 * @returns The cleaned map; the input is not mutated.
 */
export function cleanItemPointers(
	record: ChangeRecord<ItemRelatedComponent>,
	itemPointers: Record<string, string>,
): Record<string, string> {
	const previous = record.old;

	if (previous === undefined) {
		return itemPointers;
	}

	if (isComponent(previous, "Items")) {
		previous.model.Destroy();

		if (previous.moved === true) {
			return itemPointers;
		}
	}

	return filter(itemPointers, (_, key) => {
		return !previous.items.some((item) => item.guid === key);
	}) as Record<string, string>;
}

function getItemContainer(
	world: World,
	entityId: AnyEntity,
	container: N<ItemContainerLocation>,
): N<ItemContainer> {
	if (container === undefined) {
		return world.get(entityId, Components.Items) as N<ItemContainer>;
	}

	return world.get(
		entityId,
		container === "Hotbar" ? Components.Hotbar : Components.Inventory,
	) as N<ItemContainer>;
}
