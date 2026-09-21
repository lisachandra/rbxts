import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import { createItem } from "@lisachandra/matter/utils/item/lookup";
import {
	addItem,
	findNearestItem,
	getEquippedItemWithId,
	getItemFromGUID,
	getItemWithIdFromGUID,
	setItemData,
} from "@lisachandra/matter/utils/item/state";
import { beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { type AnyEntity, World } from "@rbxts/matter";

const potionPath = ["Consumable", "Potion"] as unknown as ValidItemPath;

describe("item state helpers", () => {
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

	it("should add an item to a player inventory and merge duplicate stacks", () => {
		expect.assertions(2);

		const entity = world.spawn(Components.Inventory({ items: [] })) as AnyEntity;

		const first = {
			amount: 1,
			data: { healAmount: 25 },
			guid: "guid-a",
			id: potionPath,
		};
		addItem(world, entity, "Inventory", first);

		expect(world.get(entity, Components.Inventory)!.items).toEqual([first]);

		const second = {
			amount: 2,
			data: { healAmount: 50 },
			guid: "guid-b",
			id: potionPath,
		};
		addItem(world, entity, "Inventory", second);

		// Same id stacks: keep first item, bump its amount by the second's amount.
		expect(world.get(entity, Components.Inventory)!.items[0]!.amount).toBe(3);
	});

	it("should update item data through world state", () => {
		expect.assertions(2);

		const entity = world.spawn(Components.Inventory({ items: [] })) as AnyEntity;
		const item = { ...createItem(potionPath, { healAmount: 25 }), guid: "guid-set" };
		addItem(world, entity, "Inventory", item);

		const component = world.get(entity, Components.Inventory)!;
		const updated = setItemData(world, entity, component, item, { healAmount: 99 });

		expect((updated.data as { healAmount: number }).healAmount).toBe(99);
		expect(
			(world.get(entity, Components.Inventory)!.items[0]!.data as { healAmount: number })
				.healAmount,
		).toBe(99);
	});

	it("should return undefined for unknown guids and empty worlds", () => {
		expect.assertions(2);

		expect(getItemFromGUID(world, "missing-guid")).toBeUndefined();
		expect(findNearestItem(world, potionPath, undefined as unknown as Model)).toBeUndefined();
	});

	it("should find a matching item by guid and id path and resolve the equipped item", () => {
		expect.assertions(3);

		const potionA = { amount: 1, data: { healAmount: 25 }, guid: "guid-a", id: potionPath };
		const potionB = { amount: 1, data: { healAmount: 25 }, guid: "guid-b", id: potionPath };

		const byGuid = getItemWithIdFromGUID(world, "guid-b", potionPath, [potionA, potionB]);

		expect(byGuid?.guid).toBe("guid-b");

		const notFound = getItemWithIdFromGUID(world, "guid-c", potionPath, [potionA, potionB]);

		expect(notFound).toBeUndefined();

		const entity = world.spawn(
			Components.Hotbar({ equipped: "guid-b", items: [potionA, potionB], order: ["guid-b"] }),
		) as AnyEntity;
		const equipped = getEquippedItemWithId(world, entity, potionPath);

		expect(equipped?.guid).toBe("guid-b");
	});
});
