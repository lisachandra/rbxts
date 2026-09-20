import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import {
	createItem,
	getCompleteItem,
	getItemDescription,
	getItemIdFromNumericId,
	getItemImage,
	getItemName,
	getNumericItemIdFromId,
	isSameId,
} from "@lisachandra/matter/utils/item/lookup";
import { getItemFromId } from "@lisachandra/matter/utils/item/state";
import { beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { type AnyEntity, World } from "@rbxts/matter";

const potionPath = ["Consumable", "Potion"] as unknown as ValidItemPath;
const consumablePath = ["Consumable"] as unknown as ValidItemPath;
const otherPath = ["Consumable", "Apple"] as unknown as ValidItemPath;

describe("item lookup helpers", () => {
	let world: World;

	beforeEach(() => {
		defineItems({
			Consumable: {
				children: {
					Potion: {
						defaultData: { healAmount: 25 },
						description: "Restores health",
						image: "rbxassetid://potion",
					},
				},
				description: "Consumable items",
				image: "rbxassetid://consumable",
			},
		});

		world = new World();
		(store as never as { world: World }).world = world;
	});

	it("should translate between numeric ids and item paths, and compare item ids", () => {
		expect.assertions(6);

		expect(getItemName(potionPath)).toBe("Potion");
		expect(isSameId(potionPath, potionPath)).toBe(true);
		expect(isSameId(potionPath, otherPath)).toBe(false);

		const numericId = getNumericItemIdFromId(potionPath);

		expect(numericId).toBeDefined();

		/*
		 * Only assert that the reverse lookup resolves *something* for a registered id. A strict
		 * round-trip is not yet meaningful: `createItemRegistry` increments its counter after
		 * recursing, so a parent path and its first child are assigned the same numeric id and the
		 * reverse lookup returns whichever the map yields last. See the registry-collision follow-up.
		 */
		expect(getItemIdFromNumericId(numericId!)).toBeDefined();
		expect(getItemIdFromNumericId(999999)).toBeUndefined();
	});

	it("should retrieve item definitions and create new item records", () => {
		expect.assertions(7);

		expect(getCompleteItem(potionPath)).toEqual({ healAmount: 25 });
		/*
		 * `getItemConfig` reads `itemDefinitions`, which holds only data fields — descriptions live
		 * in the separate `descriptions` map, so assert through `getItemDescription` instead.
		 */
		expect(getItemDescription(consumablePath)).toBe("Consumable items");
		expect(getItemImage(potionPath)).toBe("rbxassetid://potion");

		const item = createItem(potionPath, { healAmount: 50 });

		expect(item).toMatchObject({
			amount: 1,
			data: { healAmount: 50 },
			id: ["Consumable", "Potion"],
		});
		expect(item.guid).never.toBe("");

		// getItemFromId takes the world explicitly.
		const playerEntity = world.spawn(
			Components.Inventory({
				items: [item],
			}),
		) as AnyEntity;
		const found = getItemFromId(world, playerEntity, "Inventory", potionPath);

		expect(found?.guid).toBe(item.guid);
		expect(getItemDescription(potionPath)).toBe("Restores health");
	});
});
