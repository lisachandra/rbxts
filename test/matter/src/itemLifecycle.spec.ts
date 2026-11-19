import { store } from "@lisachandra/core/store";
import { Components } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import type { ValidItemPath } from "@lisachandra/matter/items";
import {
	createItem,
	getCompleteItem,
	getItemName,
	isSameId,
} from "@lisachandra/matter/utils/item/lookup";
import { moveItem, removeItem, setItemData } from "@lisachandra/matter/utils/item/state";
import { beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { type AnyEntity, World } from "@rbxts/matter";

/*
 * Ported from the godkin repo's `shared/utils/item.spec.ts` (#17 triage: rewrite), covering the
 * lifecycle calls — add, move, remove, and the data/definition helpers — that the lookup, policy
 * and pointer specs do not reach.
 *
 * The upstream suite built fake component objects, replaced `World` methods with `jest.fn`, and
 * asserted against those stubs. Here the world is real and the assertions read the components back
 * out after the call, which is the only way a stale pointer or a half-applied write shows up.
 *
 * `store.shared.itemPointers` is module state shared by every spec in the lane, and `removeItem` /
 * `moveItem` both resolve through it. Each spec therefore seeds only the pointers it names, and a
 * flat `beforeEach` clears the table so a pointer left by an earlier file cannot make this one
 * dereference a despawned entity.
 */

const potionPath = ["Consumable", "Potion"] as unknown as ValidItemPath;

interface TestItem {
	amount: number;
	data: { healAmount: number };
	guid: string;
	id: ValidItemPath;
}

function potion(guid: string, amount = 1): TestItem {
	return { amount, data: { healAmount: 25 }, guid, id: potionPath };
}

function spawnInventory(world: World, items: Array<TestItem>): AnyEntity {
	return world.spawn(Components.Inventory({ items })) as AnyEntity;
}

function spawnPlayer(world: World, items: Array<TestItem>): AnyEntity {
	return world.spawn(
		Components.Inventory({ items }),
		Components.Hotbar({ equipped: "", items: [], order: [] }),
	) as AnyEntity;
}

function pointer(guid: string, value: string): void {
	store.shared.update({
		itemPointers: (current) => ({ ...current, [guid]: value }),
	});
}

async function flush(): Promise<void> {
	await Promise.delay(0.02);
}

describe("item lifecycle", () => {
	let world: World;

	beforeEach(() => {
		defineItems({
			Consumable: {
				children: {
					Potion: { defaultData: { healAmount: 25 } },
				},
			},
		});

		world = new World();
		(store as never as { world: World }).world = world;

		// Drop every pointer an earlier spec seeded, and let the crate apply it.
		store.shared.update({ itemPointers: () => ({}) });
	});

	describe("createItem", () => {
		it("should merge partial data over the definition's defaults", () => {
			expect.assertions(2);

			const item = createItem(potionPath, { healAmount: 50 });

			expect(item.data).toEqual({ healAmount: 50 });
			expect(item.amount).toBe(1);
		});

		it("should keep the defaults when there is no partial data", () => {
			expect.assertions(1);

			expect(createItem(potionPath, {}).data).toEqual({ healAmount: 25 });
		});

		it("should skip the defaults when mergeSuper is false", () => {
			expect.assertions(1);

			/*
			 * `mergeSuper: false` is the path a deserialized item takes: the stored data is already
			 * complete, so merging the definition over it would resurrect defaults the player had
			 * changed — the one thing a load must not do.
			 */
			expect(createItem(potionPath, { healAmount: 7 }, false).data).toEqual({
				healAmount: 7,
			});
		});

		it("should mint a distinct GUID per call with amount one", () => {
			expect.assertions(3);

			const first = createItem(potionPath, {});
			const second = createItem(potionPath, {});

			expect(first.guid).never.toBe("");
			expect(first.guid).never.toBe(second.guid);
			expect(first.amount).toBe(1);
		});
	});

	describe("isSameId", () => {
		it("should treat an empty list and a single path as the same id", () => {
			expect.assertions(2);

			// Vacuously true, but the identity case has to hold or every stack merges with every other.
			expect(isSameId()).toBe(true);
			expect(isSameId(potionPath)).toBe(true);
		});

		it("should compare by every segment, not just the last", () => {
			expect.assertions(2);

			expect(isSameId(potionPath, ["Consumable", "Elixir"] as unknown as ValidItemPath)).toBe(
				false,
			);
			// Same leaf, different parent: comparing only the name would call these equal.
			expect(
				isSameId(
					["Consumable", "Potion"] as unknown as ValidItemPath,
					["Other", "Potion"] as unknown as ValidItemPath,
				),
			).toBe(false);
		});

		it("should reject paths of different lengths", () => {
			expect.assertions(1);

			expect(isSameId(potionPath, ["Consumable"] as unknown as ValidItemPath)).toBe(false);
		});
	});

	describe("getCompleteItem", () => {
		/*
		 * Ported from godkin's "should inherit a parent's defaults into a child", and deliberately
		 * changed: this port does not inherit. `populateDefinitions` takes the `children` branch for a
		 * parent and never writes the parent's own `defaultData` into the tree, so `Weapon`'s defaults
		 * are silently dropped — the leaf is the whole story here, unlike godkin where the walk merged
		 * parent defaults under the leaf. If inheritance ever lands, this spec is the one to rewrite.
		 */
		it("should take a deep path down to its leaf data, without parent inheritance", () => {
			expect.assertions(1);

			defineItems({
				Weapon: {
					children: {
						Sword: { defaultData: { damage: 10 } },
					},
					defaultData: { damage: 5, rarity: "common" },
				},
			});

			expect(getCompleteItem(["Weapon", "Sword"] as unknown as ValidItemPath)).toEqual({
				damage: 10,
			});
		});

		it("should answer the leaf name, not the whole path", () => {
			expect.assertions(2);

			expect(getItemName(potionPath)).toBe("Potion");
			expect(getItemName(["Consumable"] as unknown as ValidItemPath)).toBe("Consumable");
		});
	});

	describe("removeItem", () => {
		it("should remove a whole stack from an inventory", async () => {
			expect.assertions(2);

			const entity = spawnInventory(world, [potion("g1", 5)]);
			pointer("g1", `${entity}_Inventory`);
			await flush();

			const removed = removeItem(world, "g1");

			expect(removed?.guid).toBe("g1");
			// The stack was the item, so the whole entry goes rather than leaving an empty one behind.
			expect(world.get(entity, Components.Inventory)!.items.size()).toBe(0);
		});

		it("should split a stack and mint a fresh GUID for the removed part", async () => {
			expect.assertions(4);

			const entity = spawnInventory(world, [potion("g1", 5)]);
			pointer("g1", `${entity}_Inventory`);
			await flush();

			const removed = removeItem(world, "g1", 2);
			const remaining = world.get(entity, Components.Inventory)!.items[0]!;

			/*
			 * The removed portion becomes a separate item with its own identity — otherwise two items in
			 * the world would share a GUID and every pointer lookup would resolve to whichever it found
			 * first. The source keeps its GUID and loses exactly the amount taken.
			 */
			expect(removed?.amount).toBe(2);
			expect(removed?.guid).never.toBe("g1");
			expect(remaining.amount).toBe(3);
			expect(remaining.guid).toBe("g1");
		});

		it("should answer undefined for a GUID no pointer names", () => {
			expect.assertions(1);

			expect(removeItem(world, "never-seen")).toBeUndefined();
		});

		it("should answer undefined when the pointer names an empty container", async () => {
			expect.assertions(1);

			const entity = spawnInventory(world, []);
			pointer("g1", `${entity}_Inventory`);
			await flush();

			// A stale pointer is a normal race, not a crash: the item left between the two frames.
			expect(removeItem(world, "g1")).toBeUndefined();
		});

		it("should despawn a ground entity when its last item goes", async () => {
			expect.assertions(2);

			const entity = world.spawn(
				Components.Items({ items: [potion("g1", 1)], model: new Instance("Model") }),
			) as AnyEntity;
			pointer("g1", `${entity}`);
			await flush();

			const removed = removeItem(world, "g1");

			expect(removed?.guid).toBe("g1");
			// A ground entity exists only to hold its stack, so it goes with the stack.
			expect(world.contains(entity)).toBe(false);
		});

		it("should keep a ground entity alive when only part of its stack is taken", async () => {
			expect.assertions(2);

			const entity = world.spawn(
				Components.Items({ items: [potion("g1", 5)], model: new Instance("Model") }),
			) as AnyEntity;
			pointer("g1", `${entity}`);
			await flush();

			removeItem(world, "g1", 2);

			expect(world.contains(entity)).toBe(true);
			expect(world.get(entity, Components.Items)!.items[0]!.amount).toBe(3);
		});

		it("should detach the tool of a removed item", async () => {
			expect.assertions(2);

			const tool = new Instance("Tool");
			tool.Parent = new Instance("Folder");

			const entity = spawnInventory(world, [
				{ ...potion("g1"), tool } as unknown as TestItem,
			]);
			pointer("g1", `${entity}_Inventory`);
			await flush();

			const removed = removeItem(world, "g1");

			/*
			 * The tool is a live instance under a container. Leaving it parented while the item record
			 * disappears strands it: nothing owns it, nothing cleans it up, and it stays visible.
			 */
			expect(removed).toBeDefined();
			expect(tool.Parent).toBeUndefined();
		});
	});

	/*
	 * `moveItem` reads its two containers out of one multi-value `world.get`. That call used to carry
	 * an array cast, which made roblox-ts index the first return value instead of destructuring the
	 * multiple returns, so every path dereferenced a nil container (#77). These specs assert the
	 * transfers themselves rather than the crash, so a reintroduced cast fails them.
	 */
	describe("moveItem", () => {
		it("should move an item from the inventory into the hotbar", async () => {
			expect.assertions(3);

			const entity = spawnPlayer(world, [potion("g1")]);
			pointer("g1", `${entity}_Inventory`);
			await flush();

			moveItem(world, entity, "g1", "Hotbar");

			expect(world.get(entity, Components.Inventory)!.items.size()).toBe(0);
			expect(world.get(entity, Components.Hotbar)!.items.size()).toBe(1);
			expect(world.get(entity, Components.Hotbar)!.items[0]!.guid).toBe("g1");
		});

		it("should move an item from the hotbar into the inventory", async () => {
			expect.assertions(3);

			const entity = world.spawn(
				Components.Inventory({ items: [] }),
				Components.Hotbar({ equipped: "g1", items: [potion("g1")], order: ["g1"] }),
			) as AnyEntity;
			pointer("g1", `${entity}_Hotbar`);
			await flush();

			moveItem(world, entity, "g1", "Inventory");

			expect(world.get(entity, Components.Hotbar)!.items.size()).toBe(0);
			expect(world.get(entity, Components.Inventory)!.items.size()).toBe(1);
			expect(world.get(entity, Components.Inventory)!.items[0]!.guid).toBe("g1");
		});

		it("should pick a ground item up into the player's inventory", async () => {
			expect.assertions(3);

			const ground = world.spawn(
				Components.Items({ items: [potion("g1")], model: new Instance("Model") }),
			) as AnyEntity;
			const player = spawnPlayer(world, []);
			pointer("g1", `${ground}`);
			await flush();

			moveItem(world, player, "g1", "Inventory");

			expect(world.get(player, Components.Inventory)!.items.size()).toBe(1);
			expect(world.get(player, Components.Inventory)!.items[0]!.guid).toBe("g1");
			/*
			 * The ground entity is marked before the deferred despawn. `moved` is what tells the rest
			 * of the server that the item left under its own steam rather than vanishing.
			 */
			expect(world.get(ground, Components.Items)!.moved).toBe(true);
		});

		it("should do nothing when the pointer names no entity", () => {
			expect.assertions(1);

			const player = spawnPlayer(world, []);

			// No pointer at all: `itemEntityId` answers undefined and the function returns early.
			moveItem(world, player, "g1", "Inventory");

			expect(world.get(player, Components.Inventory)!.items.size()).toBe(0);
		});
	});

	describe("setItemData", () => {
		it("should merge partial data into an existing item", () => {
			expect.assertions(2);

			const entity = spawnInventory(world, [potion("g1")]);
			const component = world.get(entity, Components.Inventory)!;

			const updated = setItemData(world, entity, component, component.items[0]!, {
				healAmount: 99,
			});

			expect((updated.data as { healAmount: number }).healAmount).toBe(99);
			// The write goes through the world, not just the returned value.
			expect(
				(world.get(entity, Components.Inventory)!.items[0]!.data as { healAmount: number })
					.healAmount,
			).toBe(99);
		});

		it("should leave the item's identity untouched", () => {
			expect.assertions(2);

			const entity = spawnInventory(world, [potion("g1", 4)]);
			const component = world.get(entity, Components.Inventory)!;

			const updated = setItemData(world, entity, component, component.items[0]!, {
				healAmount: 1,
			});

			expect(updated.guid).toBe("g1");
			expect(updated.amount).toBe(4);
		});
	});
});
