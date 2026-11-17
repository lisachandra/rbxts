import ReactTemplate from "@lisachandra/react-template";
import { describe, expect, it } from "@rbxts/jest-globals";

describe("reactTemplate", () => {
	it("should build a fetch descriptor with its symbol and property names", () => {
		expect.assertions(4);

		const resolve = (value: number): number => value + 1;
		const fetch = ReactTemplate.fetch(resolve, "Visible", "Name");

		/*
		 * The descriptor carries the resolve function under the package's fetch symbol. It is read
		 * through a table cast because a symbol-keyed index is not expressible on the declared
		 * `FetchValue` shape.
		 */
		expect((fetch as unknown as Record<symbol, unknown>)[ReactTemplate._fetch]).toBe(resolve);

		// ...and the property names it should be called with, in order.
		expect(fetch.properties).toEqual(["Visible", "Name"]);

		// A descriptor with no property names asks for the property it is assigned to instead.
		expect(ReactTemplate.fetch(resolve).properties).toEqual([]);

		// The symbol is a value, not a string key, so it cannot collide with an instance property.
		expect(typeIs(ReactTemplate._fetch, "table")).toBe(true);
	});

	it("should not recognize a template it did not create", () => {
		expect.assertions(3);

		/*
		 * `is` answers from the registry of templates this module created, so a plain function, a
		 * table, and `undefined` are all "not a template". The registry is only populated in Studio,
		 * which is why this asserts the negative — it is the branch that must never throw.
		 */
		expect(ReactTemplate.is(undefined)).toBe(false);
		expect(ReactTemplate.is(() => undefined)).toBe(false);
		expect(ReactTemplate.is({})).toBe(false);
	});

	it("should expose the children key a template's props use for named child templates", () => {
		expect.assertions(1);

		expect(ReactTemplate.children).toBe("templateChildren");
	});
});
