import type { AnyEntity } from "@rbxts/matter";

/** The named item container locations that an item can be stored in. */
export type ItemContainerLocation = "Hotbar" | "Inventory";

/** The result of parsing an item pointer string. */
export interface ParsedItemPointer {
	container?: ItemContainerLocation;
	entityId: AnyEntity;
}

/**
 * Encodes an entity ID and optional container into an item pointer string.
 *
 * Ground items (`"Items"` or an omitted container) omit the suffix.
 *
 * @example
 * 	```ts
 * 	encodeItemPointer(42 as AnyEntity, "Hotbar"); // "42_Hotbar"
 * 	encodeItemPointer(42 as AnyEntity);           // "42"
 * 	```;
 *
 * @param entityId - The owning entity ID.
 * @param container - The container location, or `"Items"` or `undefined` for ground items.
 * @returns The encoded pointer string.
 */
export function encodeItemPointer(
	entityId: AnyEntity,
	container?: "Items" | ItemContainerLocation,
): string {
	return container === undefined || container === "Items"
		? `${entityId}`
		: `${entityId}_${container}`;
}

/**
 * Parses an item pointer string into its entity ID and optional container.
 *
 * Returns `undefined` for missing, empty, or malformed pointers.
 *
 * @example
 * 	```ts
 * 	parseItemPointer("42_Hotbar"); // { entityId: 42, container: "Hotbar" }
 * 	parseItemPointer("42");        // { entityId: 42 }
 * 	```;
 *
 * @param pointer - The item pointer string to parse.
 * @returns The parsed pointer, or `undefined` if invalid.
 */
export function parseItemPointer(pointer: N<string>): N<ParsedItemPointer> {
	if (pointer === undefined || pointer === "") {
		return undefined;
	}

	const parts = pointer.split("_");
	if (parts.size() < 1 || parts.size() > 2) {
		return undefined;
	}

	const entityId = tonumber(parts[0]) as N<AnyEntity>;
	if (entityId === undefined) {
		return undefined;
	}

	if (parts.size() === 1) {
		return { entityId };
	}

	const container = parts[1];
	if (container !== "Hotbar" && container !== "Inventory") {
		return undefined;
	}

	return { container, entityId };
}

/**
 * Returns the container location of an item pointer, or `undefined` if on the ground or invalid.
 *
 * @example
 * 	```ts
 * 	itemLocation("42_Hotbar"); // "Hotbar"
 * 	itemLocation("42");        // undefined
 * 	```;
 *
 * @param pointer - The item pointer string.
 * @returns The container location, or `undefined`.
 */
export function itemLocation(pointer: N<string>): N<ItemContainerLocation> {
	return parseItemPointer(pointer)?.container;
}

/**
 * Returns the owning entity ID of an item pointer, or `undefined` if invalid.
 *
 * @example
 * 	```ts
 * 	itemEntityId("42_Hotbar"); // 42
 * 	```;
 *
 * @param pointer - The item pointer string.
 * @returns The entity ID, or `undefined`.
 */
export function itemEntityId(pointer: N<string>): N<AnyEntity> {
	return parseItemPointer(pointer)?.entityId;
}
