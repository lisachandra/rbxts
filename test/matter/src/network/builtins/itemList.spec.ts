import { store } from "@lisachandra/core/store";
import {
	Components,
	createItemListCodecRegistration,
	createItemListDeserializer,
	createItemListSerializer,
	InMemoryCodecStateReader,
	type ItemData,
	registry,
} from "@lisachandra/matter";
import type { Item } from "@lisachandra/matter/components";
import { defineItems } from "@lisachandra/matter/items";
import { beforeAll, beforeEach, describe, expect, it } from "@rbxts/jest-globals";
import { component, World } from "@rbxts/matter";
import createSerializer, { type u16 } from "@rbxts/serio";
import { Workspace } from "@rbxts/services";

/*
 * Register a test-only item hierarchy so the item ID registry and serdes tree are populated.
 * This must happen before any codec logic runs, and must share the same module instance as the
 * codecs (achieved by importing `@lisachandra/matter/items`).
 */
defineItems({
	Weapon: {
		children: {
			Sword: {
				defaultData: { damage: 10, maxDurability: 100 },
				serdes: createSerializer<{ damage: u16; maxDurability: u16 }>() as never,
			},
		},
		description: "Weapons category",
		image: "rbxassetid://123",
	},
});

/** Payload/data shape used by the test item list. */
interface TestData {
	damage: number;
	maxDurability: number;
}
/** Test component: an item list keyed under a dedicated component key. */
const TestListComponent = component<{ items: Array<Item> }>("TestList", { items: [] });

interface TestPayload {
	items: Array<ItemData>;
}
interface TestComponent {
	items: Array<Item>;
}

/** Builds a valid Sword item for tests with the widest `id` shape. */
function makeItem(data: Partial<TestData> = {}, amount = 1, guid = "guid-1"): Item {
	return {
		amount,
		data: { damage: 10, maxDurability: 100, ...data } as Item["data"],
		guid,
		id: ["Weapon", "Sword"],
		tool: undefined,
	} as unknown as Item;
}

/** Populates the shared crate's itemGUIDMap so serializer/deserializer can resolve numeric IDs. */
function seedGUIDMap(): void {
	const map = store.client.getState("itemGUIDMap");
	(map as unknown as Record<string, number>)["guid-1"] = 1;
	(map as unknown as Record<string, number>)["guid-2"] = 2;
	(map as unknown as Record<string, number>)["guid-3"] = 3;
}

describe("createItemListDeserializer", () => {
	let world: World;

	beforeAll(() => {
		seedGUIDMap();
	});

	beforeEach(() => {
		world = new World();
		store.world = world as never;
	});

	it("should merge incoming items with existing client items and drop removed GUIDs", () => {
		expect.assertions(4);

		const entityId = world.spawn(
			Components.Inventory({ items: [makeItem({ damage: 5 }, 1, "guid-1")] }),
		);

		const deserializer = createItemListDeserializer<TestPayload, TestComponent>("Inventory");
		const result = deserializer(
			{ items: [{ amount: 1, blobs: undefined, buf: undefined, guid: 1, id: 0 }] },
			99 as never,
			entityId as never,
		) as TestComponent;

		/*
		 * The incoming item id 0 (Sword) merges with the existing damaged item, preserving the
		 * existing item whose GUID was not re-sent.
		 */
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.guid).toBe("guid-1");
		expect(result.items[0]!.amount).toBe(1);
		expect((result.items[0]!.data as TestData).damage).toBe(5);
	});

	it("should strip server-removed GUIDs while preserving unsent items", () => {
		expect.assertions(3);

		const entityId = world.spawn(
			Components.Inventory({
				items: [makeItem({ damage: 5 }, 1, "guid-1"), makeItem({}, 1, "guid-2")],
			}),
		);

		const deserializer = createItemListDeserializer<TestPayload, TestComponent>("Inventory");
		// `{ guid: 1 }` without `id` signals removal of guid-1; guid-2 is unsent and preserved.
		const result = deserializer(
			{ items: [{ guid: 1 }] },
			99 as never,
			entityId as never,
		) as TestComponent;

		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.guid).toBe("guid-2");
		expect((result.items[0]!.data as TestData).damage).toBe(10);
	});

	it("should tolerate removal payloads when the client entity is absent", () => {
		expect.assertions(1);

		const deserializer = createItemListDeserializer<TestPayload, TestComponent>("Inventory");
		const result = deserializer(
			{ items: [{ guid: 1 }] },
			99 as never,
			undefined,
		) as TestComponent;

		expect(result.items).toHaveLength(0);
	});

	it("should return deserialized items without error when client entity is not yet in world", () => {
		expect.assertions(2);

		const deserializer = createItemListDeserializer<TestPayload, TestComponent>("Inventory");
		const result = deserializer(
			{ items: [{ amount: 1, blobs: undefined, buf: undefined, guid: 1, id: 0 }] },
			99 as never,
			undefined,
		) as TestComponent;

		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.guid).toBe("guid-1");
	});
});

describe("createItemListSerializer", () => {
	beforeAll(() => {
		seedGUIDMap();
	});

	it("should serialize full payload on first replication and delta on subsequent replications for the same entity", () => {
		expect.assertions(3);

		const serializer = createItemListSerializer<TestComponent, TestPayload>();
		const entityId = 123 as never;

		const first = serializer(
			{
				new: TestListComponent({ items: [makeItem()] }),
				old: undefined,
			},
			1 as never,
			entityId,
			false,
			true,
		) as TestPayload;

		// First replication: full item serialized.
		expect(first.items).toHaveLength(1);
		expect(first.items[0]!).toMatchObject({ amount: 1, guid: 1, id: 0 });

		// Second replication with identical items: delta is empty.
		const second = serializer(
			{
				new: TestListComponent({ items: [makeItem()] }),
				old: TestListComponent({ items: [makeItem()] }),
			},
			1 as never,
			entityId,
			false,
			true,
		) as TestPayload;

		expect(second.items).toHaveLength(0);
	});

	it("should isolate replication state between distinct entity IDs", () => {
		expect.assertions(2);

		const serializer = createItemListSerializer<TestComponent, TestPayload>();
		const entityA = 1 as never;
		const entityB = 2 as never;

		// Entity A gets full first replication.
		serializer(
			{
				new: TestListComponent({ items: [makeItem({}, 1, "guid-1")] }),
				old: undefined,
			},
			1 as never,
			entityA,
			false,
			true,
		);

		// Entity B should also get a full first replication (its own state is empty).
		const bFirst = serializer(
			{
				new: TestListComponent({ items: [makeItem({}, 1, "guid-1")] }),
				old: undefined,
			},
			1 as never,
			entityB,
			false,
			true,
		) as TestPayload;

		expect(bFirst.items).toHaveLength(1);

		// Entity A's unchanged second replication must be an empty delta.
		const aSecond = serializer(
			{
				new: TestListComponent({ items: [makeItem({}, 1, "guid-1")] }),
				old: TestListComponent({ items: [makeItem({}, 1, "guid-1")] }),
			},
			1 as never,
			entityA,
			false,
			true,
		) as TestPayload;

		expect(aSecond.items).toHaveLength(0);
	});

	it("should serialize items using provided CodecStateReader without accessing store", () => {
		expect.assertions(3);

		const reader = new InMemoryCodecStateReader({ "guid-1": 10, "guid-2": 11 });
		const serializer = createItemListSerializer<TestComponent, TestPayload>(undefined, reader);

		const first = serializer(
			{
				new: TestListComponent({ items: [makeItem({}, 1, "guid-1")] }),
				old: undefined,
			},
			1 as never,
			123 as never,
			false,
			true,
		) as TestPayload;

		expect(first.items).toHaveLength(1);
		expect(first.items[0]!.guid).toBe(10);

		const serializedItem = first.items[0] as { id: number };

		expect(serializedItem.id).toBe(0);
	});
});

describe("createItemListCodecRegistration", () => {
	it("should produce valid replication registrations compatible with registry.register", () => {
		expect.assertions(4);

		const registration = createItemListCodecRegistration<TestComponent, TestPayload>({
			component: Components.Inventory,
			componentKey: "Inventory",
			mode: "owner",
			serializeExtras: () => ({}),
		});

		expect(registration.component).toBeDefined();
		expect(registration.mode).toBe("owner");
		expect(typeIs(registration.serializer, "function")).toBe(true);
		expect(typeIs(registration.deserializer, "function")).toBe(true);
	});
});

describe("inventory codec (slice 6)", () => {
	let world: World;

	beforeEach(() => {
		world = new World();
		store.world = world as never;
	});

	it("should replicate Inventory component with owner mode using the consolidated factory", () => {
		expect.assertions(3);

		const codec = registry.get("Inventory");

		expect(codec).toBeDefined();
		expect(codec!.mode).toBe("owner");

		// Serializer produces a full delta on first replication for an entity.
		const serialized = codec!.serializer!(
			{
				new: Components.Inventory({ items: [makeItem()] }),
				old: undefined,
			},
			1 as never,
			50 as never,
			false,
			true,
		) as TestPayload;

		expect(serialized.items).toHaveLength(1);
	});

	it("should merge existing world items when deserializing Inventory for an existing entity", () => {
		expect.assertions(2);

		const entityId = world.spawn(
			Components.Inventory({ items: [makeItem({ damage: 5 }, 1, "guid-1")] }),
		);
		const codec = registry.get("Inventory");

		expect(codec).toBeDefined();

		const result = codec!.deserializer!(
			{ items: [{ amount: 1, blobs: undefined, buf: undefined, guid: 1, id: 0 }] },
			99 as never,
			entityId as never,
		) as TestComponent;

		expect(result.items).toHaveLength(1);
	});
});

describe("hotbar codec (slice 7)", () => {
	beforeEach(() => {
		seedGUIDMap();
	});

	it("should correctly serialize and deserialize Hotbar equipped numeric ID alongside items", () => {
		expect.assertions(4);

		const codec = registry.get("Hotbar");

		expect(codec).toBeDefined();

		// Serializer: equipped changed from guid-1 (1) to guid-2 (2).
		const serialized = codec!.serializer!(
			{
				new: Components.Hotbar({
					equipped: "guid-2",
					items: [],
					order: [],
				}),
				old: Components.Hotbar({
					equipped: "guid-1",
					items: [],
					order: [],
				}),
			},
			1 as never,
			60 as never,
			false,
			true,
		) as HotbarResult;

		expect(serialized.equipped).toBe(2);

		// Deserializer: numeric 2 maps back to string guid-2.
		const deserialized = codec!.deserializer!(
			{ equipped: 2, items: [] },
			99 as never,
			undefined,
		) as HotbarComponentResult;

		expect(deserialized.equipped).toBe("guid-2");

		// Serializer with unchanged equipped omits the field.
		const unchanged = codec!.serializer!(
			{
				new: Components.Hotbar({
					equipped: "guid-1",
					items: [],
					order: [],
				}),
				old: Components.Hotbar({
					equipped: "guid-1",
					items: [],
					order: [],
				}),
			},
			1 as never,
			60 as never,
			false,
			true,
		) as HotbarResult;

		expect(unchanged.equipped).toBeUndefined();
	});
});

describe("items codec (slice 8)", () => {
	let world: World;

	beforeEach(() => {
		world = new World();
		store.world = world as never;
	});

	it("should replicate Items component with all mode and resolve model from Workspace.Items", () => {
		expect.assertions(3);

		const codec = registry.get("Items");

		expect(codec).toBeDefined();
		expect(codec!.mode).toBe("all");

		// Ensure a Workspace.Items folder with an attributed model exists.
		let itemsFolder = Workspace.FindFirstChild("Items") as Folder | undefined;
		if (!itemsFolder) {
			itemsFolder = new Instance("Folder");
			itemsFolder.Name = "Items";
			itemsFolder.Parent = Workspace;
		}

		const model = new Instance("Model");
		model.SetAttribute("serverEntityId", 42);
		model.Parent = itemsFolder;

		const deserialized = codec!.deserializer!(
			{ items: [] },
			42 as never,
			undefined,
		) as ItemsResult;

		expect(deserialized.model).toBe(model);
	});
});

interface HotbarResult {
	equipped?: u16;
	items: Array<ItemData>;
}
interface HotbarComponentResult {
	equipped: string;
	items: Array<Item>;
}
interface ItemsResult {
	items: Array<Item>;
	model: Model;
}
