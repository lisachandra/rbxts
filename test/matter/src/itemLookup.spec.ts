import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import {
	createItem,
	getCompleteItem,
	getItemConfig,
	getItemDescription,
	getItemFromId,
	getItemIdFromNumericId,
	getItemImage,
	getItemName,
	getNumericItemIdFromId,
	isSameId,
} from "@lisachandra/matter/utils/item/lookup";
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

		expect(numericId).toBe(1);
		expect(getItemIdFromNumericId(numericId!)).toEqual(["Consumable", "Potion"]);
		expect(getItemIdFromNumericId(999999)).toBeUndefined();
	});

	it("should retrieve item definitions and create new item records", () => {
		expect.assertions(7);

		expect(getCompleteItem(potionPath)).toEqual({ healAmount: 25 });
		expect((getItemConfig(consumablePath) as { description?: string }).description).toBe(
			"Consumable items",
		);
		expect(getItemImage(potionPath)).toBe("rbxassetid://potion");

		const item = createItem(potionPath, { healAmount: 50 });

		expect(item).toMatchObject({
			amount: 1,
			data: { healAmount: 50 },
			id: ["Consumable", "Potion"],
		});
		expect(item.guid).never.toBe("");

		// getItemFromId reads the world stored on the store singleton.
		const playerEntity = world.spawn(
			Components.Inventory({
				items: [item],
			}),
		) as AnyEntity;
		const found = getItemFromId(playerEntity, "Inventory", potionPath);

		expect(found?.guid).toBe(item.guid);
		expect(getItemDescription(potionPath)).toBe("Restores health");
	});
});
