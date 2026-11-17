import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import type { Item } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import {
	cleanItemPointers,
	getHeldItem,
	isValidItemAmount,
	validateDropRequest,
} from "@lisachandra/matter/utils/item/mutation";
import { beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { type AnyEntity, World } from "@rbxts/matter";

const potionPath = ["Consumable", "Potion"] as unknown as ValidItemPath;

function potion(guid: string, amount = 1): Item {
	return { amount, data: { healAmount: 25 }, guid, id: potionPath };
}

function spawnInventory(world: World, items: Array<Item>): AnyEntity {
	return world.spawn(Components.Inventory({ items })) as AnyEntity;
}

function spawnGround(world: World, items: Array<Item>): AnyEntity {
	const model = new Instance("Model");
	return world.spawn(Components.Items({ items, model })) as AnyEntity;
}

describe("item mutation policy", () => {
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

	describe("isValidItemAmount", () => {
		/*
		 * `amount` is a Serio `u16`, so `NaN`, negative, and fractional values are not constructible
		 * on the transport. Only the floor of 1 is reachable, and it is the case that mattered: `0`
		 * survived `math.min(0, stack)`, left the stack intact, and minted a zero-amount item under a
		 * fresh GUID — burning one of 65536 GUIDs and spawning a live entity per packet.
		 */
		it("should reject a zero amount and accept every legal one", () => {
			expect.assertions(5);

			expect(isValidItemAmount(0)).toBe(false);
			expect(isValidItemAmount(1)).toBe(true);
			expect(isValidItemAmount(64)).toBe(true);
			expect(isValidItemAmount(65535)).toBe(true);
			// Not reachable on `u16`, but the predicate must not invert for a caller off the wire.
			expect(isValidItemAmount(-1)).toBe(false);
		});
	});

	describe("getHeldItem", () => {
		it("should resolve an item the pointer's entity still holds", () => {
			expect.assertions(3);

			const entityId = spawnInventory(world, [potion("guid-a")]);
			const held = getHeldItem(world, { "guid-a": `${entityId}_Inventory` }, "guid-a");

			expect(held).toBeDefined();
			expect(held?.entityId).toBe(entityId);
			expect(held?.item.guid).toBe("guid-a");
		});

		it("should not resolve an item the pointer names but the owner no longer holds", () => {
			expect.assertions(3);

			const entityId = spawnInventory(world, []);
			const stale = { "guid-gone": `${entityId}_Inventory` };

			/*
			 * The state that aborted the tick: `parseItemPointer` succeeds, the entity exists, but the
			 * container is empty. The old `getItemFromGUID(world, guid)!` dereferenced `undefined` here.
			 */
			expect(getHeldItem(world, stale, "guid-gone")).toBeUndefined();

			// A pointer whose entity is gone resolves to nothing rather than throwing.
			expect(
				getHeldItem(world, { "guid-gone": "999_Inventory" }, "guid-gone"),
			).toBeUndefined();

			// A pointer for a GUID the map does not name resolves to nothing.
			expect(getHeldItem(world, {}, "guid-gone")).toBeUndefined();
		});

		it("should not resolve a pointer that names a container the entity never had", () => {
			expect.assertions(1);

			const entityId = spawnInventory(world, [potion("guid-a")]);

			// The item lives in `Inventory`, but the pointer claims `Hotbar`.
			expect(
				getHeldItem(world, { "guid-a": `${entityId}_Hotbar` }, "guid-a"),
			).toBeUndefined();
		});
	});

	describe("validateDropRequest", () => {
		it("should reject a zero amount before any item lookup or mutation", () => {
			expect.assertions(1);

			const entityId = spawnInventory(world, [potion("guid-a", 10)]);

			// No pointer is needed: the bounds check runs before the ownership check.
			expect(validateDropRequest(world, {}, entityId, "guid-a", 0)).toBe("amount");
		});

		it("should accept a legal amount for an item the caller holds", () => {
			expect.assertions(1);

			const entityId = spawnInventory(world, [potion("guid-a", 10)]);
			const pointers = { "guid-a": `${entityId}_Inventory` };

			expect(validateDropRequest(world, pointers, entityId, "guid-a", 4)).toBeUndefined();
		});

		it("should refuse an item the caller does not hold without touching the stack", () => {
			expect.assertions(2);

			const ownerId = spawnInventory(world, [potion("guid-a", 10)]);
			const thiefId = spawnInventory(world, []);
			const pointers = { "guid-a": `${ownerId}_Inventory` };

			expect(validateDropRequest(world, pointers, thiefId, "guid-a", 1)).toBe("not-owner");

			// Nothing mutated: the owner still holds the whole stack and no new GUID was minted.
			expect(world.get(ownerId, Components.Inventory)!.items[0]!.amount).toBe(10);
		});

		it("should refuse a pointer whose item is gone instead of aborting the caller", () => {
			expect.assertions(1);

			const entityId = spawnInventory(world, []);
			const pointers = { "guid-gone": `${entityId}_Inventory` };

			expect(validateDropRequest(world, pointers, entityId, "guid-gone", 1)).toBe(
				"missing-item",
			);
		});
	});

	describe("cleanItemPointers", () => {
		/*
		 * The inverted predicate kept a pointer whenever the removed component held two items, because
		 * `some((item) => key !== item.guid)` is true for every key as soon as a second item exists.
		 * Both item counts are asserted: the one-item case happened to work before the fix, so only the
		 * two-item case would have failed.
		 */
		it("should drop the pointers of every item the removed component held", () => {
			expect.assertions(2);

			const singlePointers = { "held-one": "1_Inventory" };
			const singleRecord = { old: Components.Inventory({ items: [potion("held-one")] }) };

			expect(cleanItemPointers(singleRecord, singlePointers)).toEqual({});

			const pairPointers = { "held-a": "2_Inventory", "held-b": "2_Inventory" };
			const pairRecord = {
				old: Components.Inventory({ items: [potion("held-a"), potion("held-b")] }),
			};

			// The two-item case the inverted predicate missed: neither GUID is held after removal.
			expect(cleanItemPointers(pairRecord, pairPointers)).toEqual({});
		});

		it("should keep pointers for items the removed component never held", () => {
			expect.assertions(2);

			const pointers = { "held-one": "1_Inventory" };

			// An empty container invalidates nothing.
			expect(
				cleanItemPointers({ old: Components.Inventory({ items: [] }) }, pointers),
			).toEqual(pointers);

			// A pointer to an item held elsewhere is not this record's business.
			expect(
				cleanItemPointers(
					{ old: Components.Inventory({ items: [potion("someone-else")] }) },
					pointers,
				),
			).toEqual(pointers);
		});

		it("should leave pointers alone when a ground entity's items were moved", () => {
			expect.assertions(1);

			const pointers = { "held-a": "1" };
			const record = {
				old: Components.Items({
					items: [potion("held-a")],
					model: new Instance("Model"),
					moved: true,
				}),
			};

			// `moved` means the receiving container re-points these, so cleanup must not drop them.
			expect(cleanItemPointers(record, pointers)).toEqual(pointers);
		});

		it("should drop every pointer of a ground entity whose items were not moved", () => {
			expect.assertions(1);

			const groundId = spawnGround(world, [potion("ground-a")]);
			const record = {
				old: Components.Items({
					items: [potion("ground-a")],
					model: new Instance("Model"),
				}),
			};

			expect(cleanItemPointers(record, { "ground-a": `${groundId}` })).toEqual({});
		});

		it("should return the map unchanged when there is no previous component", () => {
			expect.assertions(1);

			const pointers = { "held-a": "1_Inventory" };

			expect(cleanItemPointers({ new: Components.Inventory({ items: [] }) }, pointers)).toBe(
				pointers,
			);
		});
	});

	describe("tick integrity", () => {
		/*
		 * The regression is not that one packet fails, it is that the throw took the whole dispatch
		 * loop with it: `useMessage` has already `shift()`-ed the queued packets, so a throw discards
		 * every other player's message for that frame. Guarding the lookup keeps the loop iterating.
		 */
		it("should let a second request apply after one whose item is gone", () => {
			expect.assertions(2);

			const entityId = spawnInventory(world, [potion("guid-live", 5)]);
			const pointers = {
				"guid-gone": `${entityId}_Inventory`,
				"guid-live": `${entityId}_Inventory`,
			};

			expect(validateDropRequest(world, pointers, entityId, "guid-gone", 1)).toBe(
				"missing-item",
			);

			// The loop continues: the live request still resolves and is accepted.
			expect(validateDropRequest(world, pointers, entityId, "guid-live", 1)).toBeUndefined();
		});
	});
});
