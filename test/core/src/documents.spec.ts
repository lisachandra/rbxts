import { documentsToPersist } from "@lisachandra/core/utils/documents";
import { describe, expect, it } from "@rbxts/jest-globals";

describe("documentsToPersist", () => {
	it("should persist the new value when a document key changes", () => {
		expect.assertions(1);

		/*
		 * This is the case the middleware used to drop. Its write set came from
		 * `removeValues(previous, ...values(updated))`, which keeps only the keys whose *value* is
		 * absent from `updated` — so a changed value was never a difference and an update to an
		 * existing document never reached the profile.
		 */
		expect(
			documentsToPersist(
				{ Player_1: { credits: 100, items: ["sword"] } },
				{ Player_1: { credits: 250, items: ["sword"] } },
			),
		).toEqual([["Player_1", { credits: 250, items: ["sword"] }]]);
	});

	it("should persist a key the store did not have before", () => {
		expect.assertions(1);

		expect(documentsToPersist({}, { Player_2: { credits: 10, items: [] } })).toEqual([
			["Player_2", { credits: 10, items: [] }],
		]);
	});

	it("should write nothing for a key whose data did not change", () => {
		expect.assertions(2);

		// A no-op update must not spend a dataforge write.
		expect(
			documentsToPersist(
				{ Player_3: { credits: 5, items: [] } },
				{ Player_3: { credits: 5, items: [] } },
			),
		).toEqual([]);

		// A dropped key is not a write either: persisted data survives leaving the store.
		expect(documentsToPersist({ Player_4: { credits: 5, items: [] } }, {})).toEqual([]);
	});

	it("should compare a document by its contents, not its table identity", () => {
		expect.assertions(2);

		/*
		 * A store update that touches any field rebuilds the document table, so an identity comparison
		 * would call every touched document changed and spend a dataforge write on each. Comparing
		 * contents is what makes the no-write case reachable at all.
		 */
		expect(
			documentsToPersist(
				{ Player_5: { credits: 1, nested: { a: 1 } } },
				{ Player_5: { credits: 1, nested: { a: 1 } } },
			),
		).toEqual([]);

		// A difference nested one level down is still a difference.
		expect(
			documentsToPersist(
				{ Player_5: { credits: 1, nested: { a: 1 } } },
				{ Player_5: { credits: 1, nested: { a: 2 } } },
			),
		).toEqual([["Player_5", { credits: 1, nested: { a: 2 } }]]);
	});
});
