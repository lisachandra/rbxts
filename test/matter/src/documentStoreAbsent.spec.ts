import { getDocumentStore } from "@lisachandra/matter";
import { describe, expect, it } from "@rbxts/jest-globals";

/*
 * The absent-config case lives in its own file because `runtimeAdapters` is module state and
 * `configureRuntimeAdapters` has no "unset": a spec file gets a fresh runtime, a sibling `it` in
 * another file's sequence does not.
 */
describe("getDocumentStore without a config", () => {
	it("should resolve to undefined when no document config is configured", () => {
		expect.assertions(1);

		/*
		 * The resolver must not synthesize a handle from a missing config, which is what made a
		 * config naming neither arm a silent no-document run.
		 */
		expect(getDocumentStore(undefined)).toBeUndefined();
	});
});
