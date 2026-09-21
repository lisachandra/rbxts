import { type CodecStateReader, Components, InMemoryCodecStateReader } from "@lisachandra/matter";
import { describe, expect, it } from "@rbxts/jest-globals";
import type { AnyEntity, Component } from "@rbxts/matter";

describe("inMemoryCodecStateReader", () => {
	it("should resolve GUIDs and components from in-memory state", () => {
		expect.assertions(4);

		const guidMap = { "guid-1": 1, "guid-2": 2 };
		const testComponent = Components.Inventory({ items: [] }) as Component<object>;
		const components = new Map<AnyEntity, Partial<Record<string, Component<object>>>>();
		components.set(100 as never, { Inventory: testComponent });

		const reader = new InMemoryCodecStateReader(guidMap, components);

		expect(reader.getItemGUIDMap()).toBe(guidMap);
		expect(reader.getItemGUIDMap()["guid-1"]).toBe(1);
		expect(reader.getComponent(100 as never, "Inventory")).toBe(testComponent);
		expect(reader.getComponent(100 as never, "Hotbar")).toBeUndefined();
	});

	it("should store components via setComponent for test fixtures", () => {
		expect.assertions(2);

		const reader = new InMemoryCodecStateReader();

		reader.setComponent(
			42 as never,
			"Inventory",
			Components.Inventory({ items: [] }) as Component<object>,
		);

		expect(reader.getComponent(42 as never, "Inventory")).toBeDefined();
		expect(reader.getComponent(43 as never, "Inventory")).toBeUndefined();
	});

	it("should reflect the CodecStateReader interface", () => {
		expect.assertions(2);

		const reader: CodecStateReader = new InMemoryCodecStateReader();

		expect(typeIs(reader.getItemGUIDMap, "function")).toBe(true);
		expect(typeIs(reader.getComponent, "function")).toBe(true);
	});
});
