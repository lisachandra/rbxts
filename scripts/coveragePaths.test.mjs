/*
 * The coverage policy's arithmetic.
 *
 * These specs exist because the interesting failures here are arithmetic, not wiring: a fold that
 * averages percentages instead of summing counts reports the wrong repository number, and a floor
 * for a lane that stopped reporting silently passes if absence reads as "skip". Both are invisible
 * in a green run and both understate or overstate the coverage claim, so each is pinned here.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
	checkFloors,
	FLOORS,
	foldSummaries,
	partitionLanes,
	percentOf,
	UNMEASURED_REASONS,
} from "./coveragePaths.mjs";

/** A summary in the shape `json-summary` writes, with only the row the policy reads. */
function summary(covered, total) {
	return { lines: { covered, total } };
}

describe("percentOf", () => {
	test("should round to two decimals, so a floor cannot fail on a float artefact", () => {
		assert.equal(percentOf(30, 382), 7.85);
		assert.equal(percentOf(1, 3), 33.33);
		assert.equal(percentOf(2, 3), 66.67);
	});

	test("should answer zero when the lane counted nothing, rather than NaN", () => {
		/*
		 * A lane with no executable lines divides zero by zero, and `NaN` in a verdict compares
		 * false against every floor — a silent pass where a failure belongs.
		 */
		assert.equal(percentOf(0, 0), 0);
		assert.equal(percentOf(5, 0), 0);
	});
});

describe("foldSummaries", () => {
	test("should sum counts rather than average percentages", () => {
		/*
		 * The failure this pins: averaging 100% over 2 lines with 1% over 1000 lines gives 50.5%,
		 * which claims the repository is half covered. The true figure is 3/1002 ≈ 0.3%.
		 */
		const folded = foldSummaries([
			{ lane: "small", summary: summary(2, 2) },
			{ lane: "large", summary: summary(1, 1000) },
		]);

		assert.deepEqual(folded, { covered: 3, lines: 0.3, total: 1002 });
	});

	test("should report nothing folded when no lane measured a line", () => {
		assert.equal(foldSummaries([]), undefined);
		assert.equal(
			foldSummaries([{ lane: "empty", summary: summary(0, 0) }]),
			undefined,
			"a lane that counted nothing contributes nothing, and the fold says so",
		);
	});
});

describe("partitionLanes", () => {
	test("should treat the summary as the only evidence of measurement", () => {
		/*
		 * Six lanes in this repository declare a project and `collectCoverage: true` and still write
		 * no summary. Reading the configuration rather than the report would count all six as
		 * measured at 0%, which understates the repository by a wide margin.
		 */
		const { measured, unmeasured } = partitionLanes([
			{ lane: "demo", summary: summary(30, 382) },
			{ lane: "core", summary: undefined },
			{ lane: "ui", summary: undefined },
		]);

		assert.deepEqual(
			measured.map((entry) => entry.lane),
			["demo"],
		);
		assert.deepEqual(
			unmeasured.map((entry) => entry.lane),
			["core", "ui"],
			"the unmeasured lanes are named so a reader can tell 0% from unmeasured",
		);
	});

	test("should give every unmeasured lane a reason, including one nobody anticipated", () => {
		const { unmeasured } = partitionLanes([
			{ lane: "core", summary: undefined },
			{ lane: "brand-new", summary: undefined },
		]);

		for (const entry of unmeasured) {
			assert.ok(
				typeof entry.reason === "string" && entry.reason.length > 0,
				`${entry.lane} must say why it could not report`,
			);
		}

		assert.match(
			unmeasured.find((entry) => entry.lane === "brand-new").reason,
			/no coverage summary was written/u,
			"a lane the table does not know still gets a truthful reason",
		);
	});
});

describe("checkFloors", () => {
	test("should pass a lane at or above its floor and fail it below", () => {
		const verdicts = checkFloors([{ lane: "demo", summary: summary(8, 100) }], new Map([["demo", 7]]));
		assert.deepEqual(verdicts, [{ actual: 8, floor: 7, lane: "demo", passes: true }]);

		const failing = checkFloors([{ lane: "demo", summary: summary(6, 100) }], new Map([["demo", 7]]));
		assert.equal(failing[0].passes, false);
		assert.equal(failing[0].actual, 6, "the verdict carries the number, so the message can quote it");
	});

	test("should fail a floor whose lane stopped reporting", () => {
		/*
		 * Absence is not a skip. A floor was written because that lane once measured, so a lane that
		 * now reports nothing has regressed even though there is no percentage to compare.
		 */
		const verdicts = checkFloors([], new Map([["demo", 7]]));
		assert.deepEqual(verdicts, [{ actual: undefined, floor: 7, lane: "demo", passes: false }]);
	});

	test("should check the repository floor against the folded count", () => {
		const measured = [
			{ lane: "a", summary: summary(50, 100) },
			{ lane: "b", summary: summary(0, 100) },
		];

		/*
		 * 50/200 = 25%, not the 25% average of 50% and 0% — the same number here, so the case that
		 * tells them apart is the one in `foldSummaries`.
		 */
		const [verdict] = checkFloors(measured, new Map([["repository", 20]]));
		assert.deepEqual(verdict, { actual: 25, floor: 20, lane: "repository", passes: true });
	});

	test("should check every floor, in a stable order", () => {
		/*
		 * The floors are inserted out of alphabetical order on purpose, and the names are chosen so the
		 * sorted answer differs from the insertion order in both directions: `zeta` is inserted first
		 * but sorts last, `alpha` last but sorts first. A spec reusing the committed table would pass
		 * with the sort deleted, because that table happens to be sorted already.
		 *
		 * The map is built by `set` rather than from a literal because the formatter sorts a literal's
		 * keys, which would quietly restore the order this spec exists to disturb.
		 */
		const floors = new Map();
		floors.set("zeta", 8);
		floors.set("repository", 5);
		floors.set("alpha", 8);

		const measured = [
			{ lane: "alpha", summary: summary(9, 100) },
			{ lane: "zeta", summary: summary(9, 100) },
		];
		const verdicts = checkFloors(measured, floors);

		assert.deepEqual(
			verdicts.map((verdict) => verdict.lane),
			["alpha", "repository", "zeta"],
			"the report is ordered by lane name, not by insertion",
		);
	});
});

describe("the committed policy", () => {
	test("should hold the floors at the measured level, never below it", () => {
		/*
		 * A floor below the measurement is a regression budget nobody asked for. These are the
		 * numbers `pnpm coverage` printed when the floors were cut; a floor that moves down has to
		 * argue for it here rather than merely change the constant.
		 */
		assert.equal(FLOORS.get("demo"), 7.85);
		assert.equal(FLOORS.get("repository"), 7.85);
	});

	test("should classify every lane the repository has, so a new one cannot arrive unexplained", () => {
		/*
		 * An unclassified lane falls through to the generic reason, which is truthful but
		 * uninformative. This pins the table against the tree: adding `test/foo` without deciding
		 * whether it is expected to report fails here, rather than silently reporting "no coverage
		 * summary was written" for the rest of the repository's life.
		 */
		const testRoot = path.join(import.meta.dirname, "..", "test");
		const lanes = fs
			.readdirSync(testRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();

		// `demo` is the one lane expected to report, so it is classified by measurement instead.
		const unclassified = lanes.filter((lane) => lane !== "demo" && !UNMEASURED_REASONS.has(lane));

		assert.deepEqual(
			unclassified,
			[],
			`every lane needs a row in UNMEASURED_REASONS or a measured report; unclassified: ${unclassified.join(", ")}`,
		);
	});
});
