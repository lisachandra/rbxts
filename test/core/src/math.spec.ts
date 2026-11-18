import {
	average,
	closest,
	farthest,
	percentage,
	round,
	smoothstep,
	weightRandom,
} from "@lisachandra/core/utils/math";
import { describe, expect, it } from "@rbxts/jest-globals";

/*
 * Ported from the godkin repo's `shared/utils/math.spec.ts` (#17 triage: direct). The RuntimeLib
 * preamble is dropped for the reason in `vector.spec.ts`: none of these functions touch a runtime.
 *
 * `getServerClock` is not covered here. It reads `store` and `Workspace.GetServerTimeNow`, so it
 * belongs with the store specs rather than in a file about pure arithmetic.
 */
describe("average", () => {
	it("should sum and divide", () => {
		expect.assertions(2);

		expect(average(1, 2, 3, 4, 5)).toBe(3);
		expect(average(-1, 0, 1)).toBe(0);
	});

	it("should answer NaN for an empty list rather than zero", () => {
		expect.assertions(1);

		/*
		 * Zero is a plausible average of nothing and a lie: it would make a caller's "is this above
		 * the mean" branch silently true. NaN propagates instead.
		 */
		expect(average()).toBe(tonumber("NaN"));
	});
});

describe("closest", () => {
	it("should pick the number nearest the target", () => {
		expect.assertions(1);

		expect(closest(10, 1, 5, 12)).toBe(12);
	});

	it("should resolve a tie in favour of the earlier candidate", () => {
		expect.assertions(2);

		/*
		 * 3 and 7 are both two away from 5, and the reducer's strict `<` keeps whichever it saw
		 * first — so the answer depends on the list order. Godkin's spec asserted only that the result
		 * was *one of* the two, which hid this; pinning it means a refactor to `<=` fails here, and a
		 * caller who needs a stable pick learns it from this test rather than in production.
		 */
		expect(closest(5, 1, 3, 7, 9)).toBe(3);
		expect(closest(5, 9, 7, 3, 1)).toBe(7);
	});

	it("should handle negative numbers", () => {
		expect.assertions(1);

		// -2 and 2 are equidistant from 0, so the first one wins by strict `<`.
		expect(closest(0, -2, 2)).toBe(-2);
	});

	it("should answer the only element of a one-element list", () => {
		expect.assertions(1);

		expect(closest(5, 10)).toBe(10);
	});

	it("should answer undefined for an empty list", () => {
		expect.assertions(1);

		expect(closest(5)).toBeUndefined();
	});
});

describe("farthest", () => {
	it("should pick the number furthest from the target", () => {
		expect.assertions(1);

		expect(farthest(10, 1, 5, 12)).toBe(1);
	});

	it("should resolve a tie in favour of the earlier candidate", () => {
		expect.assertions(2);

		// 1 and 9 are both four away from 5; same first-match-wins rule as `closest`.
		expect(farthest(5, 1, 3, 7, 9)).toBe(1);
		expect(farthest(5, 9, 7, 3, 1)).toBe(9);
	});

	it("should handle negative numbers", () => {
		expect.assertions(1);

		// As with `closest`, a tie resolves to the first candidate.
		expect(farthest(0, -2, 2)).toBe(-2);
	});

	it("should answer the only element of a one-element list", () => {
		expect.assertions(1);

		expect(farthest(5, 10)).toBe(10);
	});

	it("should answer undefined for an empty list", () => {
		expect.assertions(1);

		expect(farthest(5)).toBeUndefined();
	});
});

describe("percentage", () => {
	it("should map the range onto 0..1", () => {
		expect.assertions(3);

		expect(percentage(0, 0, 10)).toBe(0);
		expect(percentage(5, 0, 10)).toBe(0.5);
		expect(percentage(10, 0, 10)).toBe(1);
	});
});

describe("round", () => {
	it("should round to the requested number of decimals", () => {
		expect.assertions(1);

		/*
		 * `12.3456` at two decimals is `12.34`: the implementation floors, it does not round half up.
		 * Asserted to three decimals rather than with `toBe`, because a float comparison against an
		 * exact literal is the kind of assertion that passes here and breaks on another platform's
		 * rounding mode.
		 */
		expect(round(12.3456, 2)).toBeCloseTo(12.34, 3);
	});

	it("should truncate rather than round half up", () => {
		expect.assertions(2);

		/*
		 * `round` is `math.floor` under the hood, so 1.5 and 1.4 both become 1. Pinned because a
		 * caller doing currency arithmetic would otherwise see 1.5 turn into 2 on one path and not the
		 * other after a refactor to `math.round`.
		 */
		expect(round(1.5, 0)).toBe(1);
		expect(round(1.4, 0)).toBe(1);
	});
});

describe("smoothstep", () => {
	it("should interpolate between the bounds", () => {
		expect.assertions(3);

		expect(smoothstep(0, 1, 0)).toBe(0);
		expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
		expect(smoothstep(0, 1, 1)).toBe(1);
	});

	it("should clamp below the lower bound", () => {
		expect.assertions(1);

		expect(smoothstep(0, 1, -1)).toBe(0);
	});

	it("should clamp at or above the upper bound", () => {
		expect.assertions(2);

		// `x >= b` returns 1, so the upper bound is inclusive while the lower one is not.
		expect(smoothstep(0, 1, 2)).toBe(1);
		expect(smoothstep(0, 1, 1)).toBe(1);
	});
});

describe("weightRandom", () => {
	it("should return an index within the list", () => {
		expect.assertions(2);

		const index = weightRandom(0.2, 0.3, 0.5);

		expect(index).toBeGreaterThanOrEqual(0);
		expect(index).toBeLessThan(3);
	});

	it("should fall through to the last index when every weight is zero", () => {
		expect.assertions(1);

		/*
		 * With a total of zero the random draw is never below the accumulator, so nothing matches and
		 * the loop ends on the final index. That is the documented fallback, not an accident of the
		 * arithmetic, so it is pinned.
		 */
		expect(weightRandom(0, 0, 0)).toBe(2);
	});

	it("should pick the only non-zero weight", () => {
		expect.assertions(2);

		expect(weightRandom(0, 0, 1)).toBe(2);
		expect(weightRandom(1)).toBe(0);
	});

	it("should answer -1 for an empty list", () => {
		expect.assertions(1);

		expect(weightRandom()).toBe(-1);
	});

	it("should honour the weights rather than the index order", () => {
		expect.assertions(1);

		/*
		 * A distribution test needs many samples to mean anything, and a flaky one is worse than none.
		 * Seeding instead fixes the draw: `math.random` is deterministic under `math.randomseed`, so
		 * the same seed always lands in the same segment of the accumulator.
		 */
		math.randomseed(12_345);
		const results = new Array<number>();

		for (const _ of $range(0, 199)) {
			results.push(weightRandom(0.1, 0.1, 0.8));
		}

		let heavy = 0;
		for (const result of results) {
			if (result === 2) {
				heavy += 1;
			}
		}

		// The heavy weight is 80% of the total, so a run of 200 should land on it most of the time.
		expect(heavy).toBeGreaterThan(120);
	});
});
