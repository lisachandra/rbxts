import type { Serializer } from "@rbxts/serio";

import { itemDefinitions, privateDefinitions, type ValidItemPath } from "./definitions";
import { descriptions } from "./descriptions";
import { serdes } from "./serdes";
import { createItemRegistry } from "./registry";

/**
 * Configuration for defining an item type in the item hierarchy.
 *
 * @typeParam TData - The type of the item's data payload (default field values).
 *
 * @remarks
 * Items can be organized hierarchically through {@link children}.
 * Leaves are defined by providing {@link defaultData} and optionally
 * {@link serdes}, while branches only need {@link children} and optional
 * metadata like {@link description} and {@link image}.
 */
export interface ItemDefinitionConfig<TData extends object = object> {
	/**
	 * Serializer/deserializer for the item's data payload.
	 * Defines which fields are replicated over the network.
	 */
	serdes?: Serializer<TData>;
	/**
	 * Default data values for the item.
	 *
	 * These serve two purposes:
	 * 1. **Type-level**: Defines the shape of `data` in `Components.Item`,
	 *    enabling type-safe access to item fields (e.g., `item.data.damage`).
	 * 2. **Runtime**: Provides default values when creating new item instances.
	 *
	 * Example: `{ damage: 10, durability: 100 }`
	 */
	defaultData?: TData;
	/** Short description of the item (for tooltips, etc.). */
	description?: string;
	/** Image asset ID for the item (e.g., `"rbxassetid://123456789"`). */
	image?: string;
	/**
	 * Keys to exclude from network replication (kept server-side only).
	 * These will be set in `privateDefinitions`.
	 *
	 * Example: `["durability", "secretData"]`
	 */
	privateKeys?: Array<string>;
	/** Nested child item definitions (e.g., Weapon -> Sword, Bow). */
	children?: Record<string, ItemDefinitionConfig>;
}

/**
 * Creates item definitions, serdes, descriptions, and registers item IDs
 * from a single unified configuration object.
 *
 * This replaces the need to manually keep `itemDefinitions`, `serdes`,
 * `descriptions`, and the item registry in sync.
 *
 * @example
 * ```ts
 * import { defineItems } from "@lisachandra/matter/items";
 * import createSerializer, { u16 } from "@rbxts/serio";
 *
 * defineItems({
 *   Weapon: {
 *     description: "Weapons category",
 *     image: "rbxassetid://123",
 *     children: {
 *       Sword: {
 *         serdes: createSerializer<{ damage: u16 }>(),
 *         defaultData: { damage: 10 },
 *         description: "A sharp blade",
 *         privateKeys: ["durability"],
 *       },
 *       Bow: {
 *         serdes: createSerializer<{ damage: u16; range: u16 }>(),
 *         defaultData: { damage: 5, range: 50 },
 *       },
 *     },
 *   },
 *   Consumable: {
 *     children: {
 *       Potion: {
 *         serdes: createSerializer<{ healAmount: u16 }>(),
 *         defaultData: { healAmount: 25 },
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * After calling this, `Components.Item` will have type-safe data fields
 * (e.g., `item.data.damage`, `item.data.healAmount`), and all item IDs
 * will be registered in the numeric ID registry.
 */
export function defineItems(config: Record<string, ItemDefinitionConfig>): void {
	populateDefinitions(itemDefinitions as Record<string, unknown>, config);
	populatePrivateDefinitions(config);

	// serdes and descriptions are populated separately to maintain their type-safe satisifes expressions
	populateSerdes(serdes as Record<string, unknown>, config);
	populateDescriptions(descriptions as Record<string, unknown>, config);

	createItemRegistry(itemDefinitions);
}

/**
 * Populates the `itemDefinitions` tree with hierarchy keys and default data values.
 *
 * Only PascalCase keys (hierarchy) are used for traversal.
 * Default data values are non-PascalCase and become the leaf data type.
 */
function populateDefinitions(
	target: Record<string, unknown>,
	source: Record<string, ItemDefinitionConfig>,
): void {
	for (const [key, value] of pairs(source)) {
		if (!typeIs(key, "string")) {
			continue;
		}

		if (value.children !== undefined) {
			const childTarget: Record<string, unknown> = {};
			target[key] = childTarget;
			populateDefinitions(childTarget, value.children);
		} else if (value.defaultData !== undefined) {
			// Spread default data as leaf values — these are non-PascalCase data fields
			target[key] = { ...(value.defaultData as Record<string, unknown>) };
		} else {
			target[key] = {};
		}
	}
}

/**
 * Populates the serdes tree matching the item definitions hierarchy.
 */
function populateSerdes(
	target: Record<string, unknown>,
	source: Record<string, ItemDefinitionConfig>,
): void {
	for (const [key, value] of pairs(source)) {
		if (!typeIs(key, "string")) {
			continue;
		}

		const slot: Record<string, unknown> = {};

		if (value.serdes !== undefined) {
			slot["serdes"] = value.serdes;
		}

		if (value.children !== undefined) {
			populateSerdes(slot, value.children);
		}

		if (next(slot)[0] !== undefined) {
			target[key] = slot;
		}
	}
}

/**
 * Populates the descriptions tree matching the item definitions hierarchy.
 */
function populateDescriptions(
	target: Record<string, unknown>,
	source: Record<string, ItemDefinitionConfig>,
): void {
	for (const [key, value] of pairs(source)) {
		if (!typeIs(key, "string")) {
			continue;
		}

		const slot: Record<string, unknown> = {};

		if (value.description !== undefined) {
			slot["description"] = value.description;
		}

		if (value.image !== undefined) {
			slot["image"] = value.image;
		}

		if (value.children !== undefined) {
			populateDescriptions(slot, value.children);
		}

		if (next(slot)[0] !== undefined) {
			target[key] = slot;
		}
	}
}

/**
 * Populates the privateDefinitions map for items that have `privateKeys`.
 */
function populatePrivateDefinitions(
	source: Record<string, ItemDefinitionConfig>,
	path: Array<string> = [],
): void {
	for (const [key, value] of pairs(source)) {
		if (!typeIs(key, "string")) {
			continue;
		}

		const currentPath = [...path, key] as unknown as ValidItemPath;

		if (value.privateKeys !== undefined && value.privateKeys.size() > 0) {
			privateDefinitions.set(currentPath, value.privateKeys);
		}

		if (value.children !== undefined) {
			populatePrivateDefinitions(value.children, currentPath);
		}
	}
}
