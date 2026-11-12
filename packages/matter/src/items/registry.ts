import { isPascalCase } from "@lisachandra/core/utils/string";
import { iterate } from "@lisachandra/core/utils/type";

import type { ValidItemPath } from "./definitions";

/**
 * Maps item hierarchy paths to their unique numeric IDs.
 *
 * @remarks
 *   Populated by {@link createItemRegistry} during item definition setup. Used to look up items by
 *   either their string path or numeric ID.
 */
export const itemIds = new Map<ValidItemPath, number>();

let itemId = 0;

/**
 * Recursively registers item paths from the item definitions tree into the {@link itemIds} map,
 * assigning each a unique incrementing numeric ID.
 *
 * @remarks
 *   The counter is pre-order: a node takes its ID before its children are visited, so every node
 *   reaches `itemId++` exactly once. Incrementing _after_ the recursion instead gave a parent and
 *   its first child the same number, because the child's own increment happened first and the
 *   parent then reused the value. Two items sharing one wire ID made `getItemIdFromNumericId`
 *   return whichever path the map yielded last. Only PascalCase keys are treated as hierarchy
 *   nodes; non-PascalCase keys (data fields) are skipped.
 * @param object - The item definitions object tree to register.
 * @param id - The current path prefix (used internally for recursion).
 */
export function createItemRegistry(
	object: object,
	id: ValidItemPath = [] as Array<string> as ValidItemPath,
): void {
	for (const [key, value] of iterate(object)) {
		if (!typeIs(key, "string") || !typeIs(value, "table") || !isPascalCase(key)) {
			continue;
		}

		const newId = [...id, key] as unknown as ValidItemPath;
		itemIds.set(newId, itemId);
		itemId++;
		createItemRegistry(value, newId);
	}
}
