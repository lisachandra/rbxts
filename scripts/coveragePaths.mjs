/*
 * The coverage policy's arithmetic, kept pure so it can be tested without a suite run.
 *
 * `scripts/coverage.mjs` is the entry point; this module answers every question the entry point
 * asks, from data. The split mirrors `hoistPaths.mjs` / `hoist.mjs`: a spec should not have to run
 * a coverage suite to test how a summary is folded, and an entry point should not be a library.
 *
 * The floors live here rather than in the prose, because a number stated in a document and a number
 * enforced in code drift apart the moment either moves. `docs/agents/coverage.md` points at this
 * module instead of repeating it.
 */

/*
 * Why a lane cannot report, keyed by lane name — exceptions only.
 *
 * A lane is measured by the presence of its summary, never by this table: the report is the only
 * evidence that probes were actually placed, and the lanes once declared projects plus
 * `collectCoverage: true` while emitting nothing. This map supplies the sentence a human reads about
 * a lane with no summary; a lane listed here that starts reporting is treated as measured.
 *
 * The table is empty as of 2026-11-19. It began with six rows — every package lane shared one cause,
 * a `$path` mount that left the lane's instrumented frame, and `docs/agents/coverage.md` tells that
 * story — but the harness now instruments the mounted packages, so a missing summary has no known
 * cause left. A lane that stops reporting fails its floor in `checkFloors`; a new lane that cannot
 * report yet gets a row here, and the spec pins that choice against the tree.
 */
export const UNMEASURED_REASONS = new Map();

/*
 * Floors, cut from the measured level rather than from a target.
 *
 * Every lane measured on 2026-11-19, the first run that probed the mounted packages as well as the
 * lane's own specs — the harness release that made it possible is `@isentinel/jest-roblox`
 * v0.4.13-fork.2, and `jest.shared.ts` names the universe that run probed. Each floor sits at the
 * number `pnpm coverage` prints for its lane, computed by `percentOf` from the same counts — not at
 * Istanbul's own `pct`, which floors rather than rounds and can sit a hundredth below what the gate
 * prints. The destination is 90% (`#19`), but a floor is not a goal: it is a promise that the number
 * will not go down. Setting it at the measurement makes every regression a failure today, and the
 * ratchet rule — floors move up when the measurement does, never down — is what carries it to the
 * destination without a threshold that fails before the tests exist.
 *
 * A consequence worth stating, because it will be felt: adding an untested file lowers the
 * percentage and fails the floor. That is intended pressure rather than a workaround target, and the
 * answer is a test, not a widened ignore list.
 *
 * `repository` folds every measured lane, so it keeps holding as lanes come and go; a lane floor
 * disappears the day that lane stops reporting — as a failure, per `checkFloors`.
 */
export const FLOORS = new Map([
	["core", 26.86],
	["demo", 8.65],
	["matter", 25.05],
	["platform", 14.37],
	["react-router", 12.88],
	["react-template", 11.05],
	["repository", 16.34],
	["ui", 19.12],
]);

/**
 * One lane's coverage summary, as `json-summary` writes it.
 *
 * The `total` row is the only one the policy reads: per-file numbers are for a human reading the
 * report, and gating on them would make an unrelated file's test run fail another file's budget.
 *
 * @typedef {object} CoverageSummary
 * @property {{ covered: number, total: number }} lines - Line counts across the lane.
 */

/**
 * Folds measured lanes into one repository-wide line count.
 *
 * Sums counts, never percentages: averaging lanes' percentages would weight a ten-line lane and a
 * ten-thousand-line lane equally, which is the one thing a repository-wide number must not do.
 *
 * @param measured - Lanes with a summary.
 * @returns The summed counts and the resulting percentage, or `undefined` when nothing was measured.
 */
export function foldSummaries(measured) {
	let covered = 0;
	let total = 0;

	for (const { summary } of measured) {
		const lines = summary.lines;
		if (lines === undefined) {
			continue;
		}

		covered += lines.covered;
		total += lines.total;
	}

	if (total === 0) {
		return undefined;
	}

	return { covered, lines: percentOf(covered, total), total };
}

/**
 * A percentage, rounded the way a report shows it.
 *
 * Two decimals, because the difference between 7.85% and 7.86% is the difference between a floor
 * that holds and a floor that fails for a rounding artefact.
 *
 * @param covered - Counted lines with a probe.
 * @param total - Counted lines.
 * @returns The percentage, or 0 when there is nothing to divide.
 */
export function percentOf(covered, total) {
	if (total <= 0) {
		return 0;
	}

	return Math.round((covered / total) * 10_000) / 100;
}

/** Floors in a stable order, so a report that reorders between runs is a diff nobody can read. */
function sortedFloors(floors) {
	return [...floors].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Every floor the measured lanes must clear, with the numbers beside each other.
 *
 * A floor below the measured level is a regression budget nobody asked for; a floor above it fails
 * immediately. Both are reported as one verdict per bound, so a failure says which lane, by how much,
 * and against which floor.
 *
 * @param measured - Lanes with a summary.
 * @param floors - Floor per lane name, plus the `repository` key for the repo-wide floor.
 * @returns One verdict per floor, in a stable order.
 */
export function checkFloors(measured, floors) {
	const byLane = new Map(measured.map((entry) => [entry.lane, entry]));
	const verdicts = [];

	for (const [lane, floor] of sortedFloors(floors)) {
		if (lane === "repository") {
			const folded = foldSummaries(measured);
			if (folded === undefined) {
				continue;
			}

			verdicts.push({ actual: folded.lines, floor, lane, passes: folded.lines >= floor });
			continue;
		}

		const entry = byLane.get(lane);
		if (entry === undefined) {
			/*
			 * A floor for a lane that did not report is a failure, not a skip: the floor was written
			 * against a measurement that existed, so its absence means the lane stopped measuring —
			 * exactly the regression the floor is there to catch.
			 */
			verdicts.push({ actual: undefined, floor, lane, passes: false });
			continue;
		}

		const lines = entry.summary.lines;
		const actual = lines === undefined ? 0 : percentOf(lines.covered, lines.total);
		verdicts.push({ actual, floor, lane, passes: actual >= floor });
	}

	return verdicts;
}

/**
 * Separates the lanes that reported from the lanes that could not.
 *
 * @param entries - Lane name and its summary, or `undefined` when no summary was read.
 * @returns The measured lanes and the unmeasured ones with their reasons, each in name order.
 */
export function partitionLanes(entries) {
	const measured = [];
	const unmeasured = [];

	for (const entry of entries) {
		if (entry.summary === undefined) {
			unmeasured.push({
				lane: entry.lane,
				reason: UNMEASURED_REASONS.get(entry.lane) ?? "no coverage summary was written",
			});
		} else {
			measured.push({ lane: entry.lane, summary: entry.summary });
		}
	}

	measured.sort((left, right) => left.lane.localeCompare(right.lane));
	unmeasured.sort((left, right) => left.lane.localeCompare(right.lane));

	return { measured, unmeasured };
}
