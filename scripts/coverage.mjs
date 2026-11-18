#!/usr/bin/env node

/*
 * `pnpm coverage`: reads every lane's `coverage-summary.json` and reports what was actually measured.
 *
 * The point of this entry point is the distinction the six empty lanes taught: a lane that wrote no
 * summary was never measured, and reporting it as 0% would both understate the repository and hide
 * the harness defect. So this prints the measured lanes with their numbers, names each unmeasured
 * lane with its reason, folds the repository figure from counts, and only then applies the floors.
 *
 * It reads reports rather than running suites. Running is the test job's work and already happens in
 * CI; a second runner here would either duplicate it or quietly diverge from it. The consequence is
 * that a stale report is read as a current one — `jest.shared.ts` writes the summary on every run,
 * which is what makes running the suites first the only thing a caller has to remember.
 *
 * Exits 1 when a floor is missed.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { checkFloors, FLOORS, foldSummaries, partitionLanes, percentOf } from "./coveragePaths.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** Every lane directory under `test/`, in name order. */
function laneNames() {
	const testRoot = path.join(root, "test");
	if (!fs.existsSync(testRoot)) {
		return [];
	}

	return fs
		.readdirSync(testRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

/**
 * One lane's summary, or `undefined` when the lane wrote none.
 *
 * The absence is the answer, not an error: a lane with no summary was not measured, and that is a
 * fact the report has to state rather than a failure to paper over.
 *
 * @param lane - Lane directory name.
 * @returns The parsed summary, or `undefined`.
 */
function readSummary(lane) {
	const summaryPath = path.join(root, "test", lane, "coverage", "coverage-summary.json");
	if (!fs.existsSync(summaryPath)) {
		return undefined;
	}

	return JSON.parse(fs.readFileSync(summaryPath, "utf8")).total;
}

function main() {
	const entries = laneNames().map((lane) => {
		return { lane, summary: readSummary(lane) };
	});
	const { measured, unmeasured } = partitionLanes(entries);
	const folded = foldSummaries(measured);

	/*
	 * One verdict set for both modes. The badge must not disagree with the gate: a report that fails a
	 * floor still publishes the number that failed, and printing it from a second calculation is how
	 * the two drift apart.
	 */
	const verdicts = checkFloors(measured, FLOORS);
	const passes = verdicts.every((verdict) => verdict.passes);

	/*
	 * `--json` prints one object and nothing else, because CI parses it: the workflow's coverage
	 * badge needs `repository` and a reader of the raw workflow should not have to re-derive the fold.
	 * The human report stays the default, since that is what a developer runs.
	 */
	if (process.argv.includes("--json")) {
		process.stdout.write(
			`${JSON.stringify({
				measured: measured.map(({ lane, summary }) => {
					const lines = summary.lines ?? { covered: 0, total: 0 };
					return { covered: lines.covered, lane, lines: percentOf(lines.covered, lines.total), total: lines.total };
				}),
				repository: folded === undefined ? undefined : folded.lines,
				unmeasured,
			})}\n`,
		);

		return passes ? 0 : 1;
	}

	console.log("Coverage — measured lanes");

	if (measured.length === 0) {
		console.log("  none");
	}

	for (const { lane, summary } of measured) {
		const lines = summary.lines ?? { covered: 0, total: 0 };
		const pct = percentOf(lines.covered, lines.total);
		console.log(`  ${lane}: ${pct}% lines (${lines.covered}/${lines.total})`);
	}

	console.log(
		folded === undefined
			? "\nRepository: no lane measured a line"
			: `\nRepository: ${folded.lines}% lines (${folded.covered}/${folded.total}) across ${measured.length} lane(s)`,
	);

	if (unmeasured.length > 0) {
		console.log("\nNot measured — counted as unmeasured, never as 0%");
		for (const { lane, reason } of unmeasured) {
			console.log(`  ${lane}: ${reason}`);
		}
	}

	const failures = verdicts.filter((verdict) => !verdict.passes);

	console.log("\nFloors");
	for (const { actual, floor, lane, passes } of verdicts) {
		const shown = actual === undefined ? "did not report" : `${actual}%`;
		console.log(`  ${passes ? "✓" : "✗"} ${lane}: ${shown} (floor ${floor}%)`);
	}

	return failures.length === 0 ? 0 : 1;
}

process.exitCode = main();
