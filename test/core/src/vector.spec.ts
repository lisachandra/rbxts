import { distance, reflect } from "@lisachandra/core/utils/vector";
import { describe, expect, it } from "@rbxts/jest-globals";

/*
 * Ported from the godkin repo's `shared/utils/vector.spec.ts` (#17 triage: direct). The preamble
 * that spec carried — a RuntimeLib mock, `resetTSRuntime`, `restoreAllMocks` — is gone: this module
 * imports nothing that needs a runtime, so the mock only tested the mock.
 */
describe("reflect", () => {
	it("should leave a perpendicular vector unchanged", () => {
		expect.assertions(1);

		// The dot product is 0, so the surface contributes nothing and the vector passes through.
		expect(reflect(new Vector3(0, 1, 0), new Vector3(1, 0, 0))).toEqual(new Vector3(1, 0, 0));
	});

	it("should reflect a vector that points straight into the surface", () => {
		expect.assertions(1);

		expect(reflect(new Vector3(0, 1, 0), new Vector3(0, -1, 0))).toEqual(new Vector3(0, 1, 0));
	});

	it("should reflect a vector that points straight away from the surface", () => {
		expect.assertions(1);

		expect(reflect(new Vector3(0, 1, 0), new Vector3(0, 1, 0))).toEqual(new Vector3(0, -1, 0));
	});

	it("should return a unit vector when both inputs are unit vectors", () => {
		expect.assertions(1);

		/*
		 * Reflection preserves length, so normalised inputs must produce a normalised output. Asserting
		 * only the magnitude is deliberate: the exact direction is an implementation detail of the
		 * formula, while the length invariant is what callers rely on.
		 */
		const reflected = reflect(new Vector3(1, 1, 1).Unit, new Vector3(-1, 0, 1).Unit);

		expect(reflected.Magnitude).toBeCloseTo(1);
	});
});

describe("distance", () => {
	it("should measure the Euclidean distance between two points", () => {
		expect.assertions(1);

		expect(distance(new Vector3(0, 0, 0), new Vector3(5, 0, 0))).toBe(5);
	});

	it("should not depend on the argument order", () => {
		expect.assertions(2);

		const a = new Vector3(1, 2, 3);
		const b = new Vector3(-4, 5, 6);

		expect(distance(a, b)).toBeCloseTo(distance(b, a));
		expect(distance(a, a)).toBe(0);
	});
});
