import { isPascalCase } from "@lisachandra/core/out/utils/string";
import { iterate } from "@lisachandra/core/out/utils/type";

import type { ValidItemPath } from "./definitions";

export const itemIds = new Map<ValidItemPath, number>();

let itemId = 0;

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
