import { isPascalCase } from "@lisachandra/core/out/utils/string";
import { iterate } from "@lisachandra/core/out/utils/type";

import type { ValidItemPath } from "./definitions";

/**
 * Maps item hierarchy paths to their unique numeric IDs.
 *
 * @remarks
 * Populated by {@link createItemRegistry} during item definition setup.
 * Used to look up items by either their string path or numeric ID.
 */
export const itemIds = new Map<ValidItemPath, number>();

let itemId = 0;

/**
 * Recursively registers item paths from the item definitions tree into the
 * {@link itemIds} map, assigning each a unique incrementing numeric ID.
 *
 * @param object - The item definitions object tree to register.
 * @param id - The current path prefix (used internally for recursion).
 *
 * @remarks
 * Only PascalCase keys are treated as hierarchy nodes; non-PascalCase keys
 * (data fields) are skipped.
 */
export function createItemRegistry(object: object, id: ValidItemPath = [] as Array<string> as ValidItemPath): void {
	for (const [key, value] of iterate(object)) {
		if (!typeIs(key, "string") || !typeIs(value, "table") || !isPascalCase(key)) {
			continue;
		}

		const newId = [...id, key] as unknown as ValidItemPath;
		itemIds.set(newId, itemId);
		createItemRegistry(value, newId);
		itemId++;
	}
}
