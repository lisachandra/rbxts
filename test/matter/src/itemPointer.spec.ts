import {
	encodeItemPointer,
	itemEntityId,
	itemLocation,
	parseItemPointer,
} from "@lisachandra/matter/utils/itemPointer";
import { describe, expect, it } from "@rbxts/jest-globals";
import type { AnyEntity } from "@rbxts/matter";

describe("item pointer", () => {
	it("should encode ground items without container suffix and containers with suffix", () => {
		expect.assertions(4);
		expect(encodeItemPointer(1 as AnyEntity)).toBe("1");
		expect(encodeItemPointer(1 as AnyEntity, "Items")).toBe("1");
		expect(encodeItemPointer(2 as AnyEntity, "Hotbar")).toBe("2_Hotbar");
		expect(encodeItemPointer(3 as AnyEntity, "Inventory")).toBe("3_Inventory");
	});

	it("should parse valid ground, hotbar, and inventory pointer strings", () => {
		expect.assertions(3);
		expect(parseItemPointer("1")).toEqual({ entityId: 1 });
		expect(parseItemPointer("2_Hotbar")).toEqual({ container: "Hotbar", entityId: 2 });
		expect(parseItemPointer("3_Inventory")).toEqual({ container: "Inventory", entityId: 3 });
	});

	it("should return undefined when parsing malformed or missing pointers", () => {
		expect.assertions(7);
		expect(parseItemPointer(undefined)).toBeUndefined();
		expect(parseItemPointer("")).toBeUndefined();
		expect(parseItemPointer("invalid")).toBeUndefined();
		expect(parseItemPointer("invalid_Hotbar")).toBeUndefined();
		expect(parseItemPointer("123_Chest")).toBeUndefined();
		expect(parseItemPointer("123_Items")).toBeUndefined();
		expect(parseItemPointer("123_Hotbar_Extra")).toBeUndefined();
	});

	it("should extract entityId and container location via accessors", () => {
		expect.assertions(6);
		expect(itemLocation("2_Hotbar")).toBe("Hotbar");
		expect(itemEntityId("2_Hotbar")).toBe(2);
		expect(itemLocation("1")).toBeUndefined();
		expect(itemEntityId("1")).toBe(1);
		expect(itemLocation("invalid")).toBeUndefined();
		expect(itemEntityId("invalid")).toBeUndefined();
	});

	it("should guarantee round-trip stability between encoding and parsing", () => {
		expect.assertions(12);

		const testCases: Array<[AnyEntity, N<"Hotbar" | "Inventory">]> = [
			[1 as AnyEntity, undefined],
			[42 as AnyEntity, "Hotbar"],
			[100 as AnyEntity, "Inventory"],
		];

		for (const [entityId, container] of testCases) {
			const encoded = encodeItemPointer(entityId, container);
			const parsed = parseItemPointer(encoded);

			expect(parsed).toBeDefined();
			expect(parsed?.entityId).toBe(entityId);
			expect(parsed?.container).toBe(container);
			expect(encodeItemPointer(parsed!.entityId, parsed!.container)).toBe(encoded);
		}
	});
});
