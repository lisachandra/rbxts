import ReactTemplate from "@lisachandra/react-template";
import { describe, expect, it } from "@rbxts/jest-globals";

describe("reactTemplate", () => {
	it("should build a fetch descriptor with its property names, in the order given", () => {
		expect.assertions(4);

		const resolve = (value: number): number => value + 1;
		const fetch = ReactTemplate.fetch(resolve, "Visible", "Name");

		/*
		 * The descriptor's contract is what a template reads back: the names it should be resolved
		 * with, in order. Asserting the private `_fetch` symbol instead would restate the
		 * implementation — and this lane has no `@rbxts/react`, so it cannot render a template to
		 * observe the resolution end to end.
		 */
		expect(fetch.properties).toEqual(["Visible", "Name"]);

		// A descriptor with no property names asks for the property it is assigned to instead.
		expect(ReactTemplate.fetch(resolve).properties).toEqual([]);

		// Each call produces its own descriptor, so one fetch cannot overwrite another's names.
		const first = ReactTemplate.fetch(resolve, "A");
		const second = ReactTemplate.fetch(resolve, "B");

		expect(first.properties).toEqual(["A"]);
		expect(second.properties).toEqual(["B"]);
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
