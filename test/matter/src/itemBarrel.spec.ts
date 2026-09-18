import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import {
	addItem,
	createItem,
	getItemFromGUID,
	getItemName,
	getNumericItemIdFromId,
	isSameId,
} from "@lisachandra/matter/utils/item";
import { beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { type AnyEntity, World } from "@rbxts/matter";

const potionPath = ["Consumable", "Potion"] as unknown as ValidItemPath;

describe("deprecated item barrel", () => {
	let world: World;

	beforeEach(() => {
		defineItems({
			Consumable: {
				children: {
					Potion: {
						defaultData: { healAmount: 25 },
					},
				},
			},
		});

		world = new World();
		(store as never as { world: World }).world = world;
	});

	it("should still expose pure lookup helpers with delegation", () => {
		expect.assertions(4);

		expect(getItemName(potionPath)).toBe("Potion");
		expect(isSameId(potionPath, potionPath)).toBe(true);
		expect(getNumericItemIdFromId(potionPath)).toBe(1);

		const item = createItem(potionPath, { healAmount: 50 });

		expect(item).toMatchObject({ amount: 1, data: { healAmount: 50 }, id: potionPath });
	});

	it("should still expose state helpers that delegate to the store world", () => {
		expect.assertions(3);

		const entity = world.spawn(Components.Inventory({ items: [] })) as AnyEntity;
		const item = createItem(potionPath, { healAmount: 25 });

		addItem(entity, "Inventory", item);

		const found = getItemFromGUID(item.guid);

		expect(found?.guid).toBe(item.guid);

		const { items } = world.get(entity, Components.Inventory)!;

		expect(items).toEqual([item]);
		expect(items[0]!.amount).toBe(1);
	});
});
