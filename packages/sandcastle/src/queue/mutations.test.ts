/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, locateIssue, type QueueManifest } from "./manifest.js";
import {
	addRule,
	addToSequence,
	defineSequence,
	deleteRule,
	matchingRules,
	midChainInsertionConflict,
	placeIssue,
	removeIssue,
} from "./mutations.js";
import { computeQueueView } from "./render.js";

registerTestHooks();

function base(): QueueManifest {
	return { ...emptyQueueManifest(), updatedAt: "2026-01-01T00:00:00.000Z" };
}

function issue(number: string): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: [],
		ready: true,
		state: "OPEN",
		title: `Issue ${number}`,
		wayfinder: false,
	};
}

function live(...entries: Array<LiveIssue>): LiveQueueState {
	const issues = new Map<string, LiveIssue>();
	for (const entry of entries) {
		issues.set(entry.number, entry);
	}

	return { issues, readyIssues: [], truncated: false };
}

describe("queue mutations", () => {
	test("defineSequence creates a sequence and lifts gated/human members into it", () => {
		const start: QueueManifest = {
			...base(),
			gated: [{ issue: "2", reason: "waiting" }],
		};
		const next = defineSequence(start, { issues: ["1", "2", "3"], name: "U2" });

		assert.deepEqual(next.sequences, [{ issues: ["1", "2", "3"], name: "U2" }]);
		assert.deepEqual(next.gated, []);
		assert.equal(locateIssue(next, "2")?.kind, "sequence");
	});

	test("defineSequence replaces membership and keeps the batch labels", () => {
		const start = defineSequence(base(), {
			after: "audio-seam-work",
			issues: ["1", "2"],
			name: "U2",
			notes: "old notes",
			roles: { "1": "shell" },
			title: "ui wiring",
		});
		const next = defineSequence(start, { issues: ["2", "3"], name: "U2" });

		/*
		 * The label half of a batch survives a membership edit: dropping it is how the readable
		 * manifest decayed into bare issue numbers whenever `queue sequence` was re-run.
		 */
		assert.deepEqual(next.sequences, [
			{
				after: "audio-seam-work",
				issues: ["2", "3"],
				name: "U2",
				notes: "old notes",
				roles: { "1": "shell" },
				title: "ui wiring",
			},
		]);
	});

	test("defineSequence keeps the batch's position in the run order", () => {
		const start: QueueManifest = {
			...base(),
			sequences: [
				{ issues: ["1"], name: "A" },
				{ issues: ["2"], name: "U2" },
				{ issues: ["3"], name: "B" },
			],
		};
		const next = defineSequence(start, { issues: ["2", "4"], name: "U2", title: "ui wiring" });

		/*
		 * Run order is the array order, so a redefinition must not re-rank the queue. Appending is how
		 * folding a batch silently pushed the largest batches to the back of the schedule.
		 */
		assert.deepEqual(
			next.sequences.map((entry) => entry.name),
			["A", "U2", "B"],
		);
		assert.deepEqual(next.sequences[1], { issues: ["2", "4"], name: "U2", title: "ui wiring" });
	});

	test("defineSequence appends a new batch and honours --before", () => {
		const start: QueueManifest = {
			...base(),
			sequences: [
				{ issues: ["1"], name: "A" },
				{ issues: ["2"], name: "B" },
			],
		};

		assert.deepEqual(
			defineSequence(start, { issues: ["3"], name: "NEW" }).sequences.map(
				(entry) => entry.name,
			),
			["A", "B", "NEW"],
		);
		assert.deepEqual(
			defineSequence(start, { before: "B", issues: ["3"], name: "NEW" }).sequences.map(
				(entry) => entry.name,
			),
			["A", "NEW", "B"],
		);
	});

	test("defineSequence rejects an unusable --before", () => {
		const start: QueueManifest = { ...base(), sequences: [{ issues: ["1"], name: "A" }] };

		assert.throws(
			() => defineSequence(start, { before: "A", issues: ["1"], name: "A" }),
			/--before A is the batch being defined/u,
		);
		assert.throws(
			() => defineSequence(start, { before: "ghost", issues: ["2"], name: "NEW" }),
			/--before ghost is not a defined batch/u,
		);
	});

	test("defineSequence --last moves a batch to the tail", () => {
		const start: QueueManifest = {
			...base(),
			sequences: [
				{ issues: ["1"], name: "A" },
				{ issues: ["2"], name: "B" },
				{ issues: ["3"], name: "C" },
			],
		};
		const next = defineSequence(start, { issues: ["1"], last: true, name: "A" });

		assert.deepEqual(
			next.sequences.map((entry) => entry.name),
			["B", "C", "A"],
		);
	});

	test("defineSequence rejects a role for a non-member issue", () => {
		assert.throws(() => {
			defineSequence(base(), { issues: ["1"], name: "U2", roles: { "2": "ghost" } });
		}, /--roles names #2/u);
	});

	test("placeIssue keeps the join target across a re-gate", () => {
		const start: QueueManifest = {
			...base(),
			gated: [{ issue: "5", joins: "V", reason: "waiting" }],
		};
		const next = placeIssue(start, { issue: "5", reason: "still waiting", target: "gated" });

		assert.deepEqual(next.gated, [{ issue: "5", joins: "V", reason: "still waiting" }]);
	});

	test("defineSequence refuses to steal issues from another sequence", () => {
		const start = defineSequence(base(), { issues: ["1", "2"], name: "U2" });

		assert.throws(() => {
			defineSequence(start, { issues: ["2"], name: "U3" });
		}, /already belongs to batch "U2"/u);
	});

	test("defineSequence rejects duplicate issues", () => {
		assert.throws(() => {
			defineSequence(base(), { issues: ["1", "1"], name: "U2" });
		}, /contains duplicates/u);
	});

	test("addToSequence appends, lifts gated issues, and preserves other sequences", () => {
		const start: QueueManifest = {
			...base(),
			gated: [{ issue: "5", reason: "waiting" }],
			sequences: [
				{ issues: ["1"], name: "U1" },
				{ issues: [], name: "U2" },
			],
		};
		const next = addToSequence(start, { issue: "5", sequence: "U2" });
		const u2 = next.sequences.find((sequence) => {
			return sequence.name === "U2";
		});

		assert.deepEqual(u2?.issues, ["5"]);
		assert.deepEqual(next.gated, []);
	});

	test("addToSequence honors --after for insertion position", () => {
		const start = defineSequence(base(), { issues: ["1", "3"], name: "U2" });
		const next = addToSequence(start, { after: "1", issue: "2", sequence: "U2" });

		assert.deepEqual(next.sequences[0]?.issues, ["1", "2", "3"]);
	});

	test("addToSequence rejects --after pointing at the issue being moved", () => {
		const start = defineSequence(base(), { issues: ["1", "2", "3"], name: "U2" });

		assert.throws(() => {
			addToSequence(start, { after: "2", issue: "2", sequence: "U2" });
		}, /cannot be inserted after itself/u);
	});

	test("addToSequence throws when the sequence is not defined", () => {
		assert.throws(() => {
			addToSequence(base(), { issue: "1", sequence: "missing" });
		}, /is not defined/u);
	});

	test("addToSequence throws when the issue already sits in a different sequence", () => {
		const start: QueueManifest = {
			...base(),
			sequences: [
				{ issues: ["1"], name: "U1" },
				{ issues: [], name: "U2" },
			],
		};

		assert.throws(() => {
			addToSequence(start, { issue: "1", sequence: "U2" });
		}, /already belongs to batch "U1"/u);
	});

	test("addToSequence throws when --after is not a member", () => {
		const start = defineSequence(base(), { issues: ["1"], name: "U2" });

		assert.throws(() => {
			addToSequence(start, { after: "9", issue: "2", sequence: "U2" });
		}, /--after 9 is not a member/u);
	});

	test("placeIssue adds to gated and always moves the issue from anywhere", () => {
		const start = defineSequence(base(), { issues: ["1"], name: "U2" });
		const gated = placeIssue(start, { issue: "1", reason: "blocked", target: "gated" });

		assert.deepEqual(gated.gated, [{ issue: "1", reason: "blocked" }]);
		assert.deepEqual(gated.sequences, [{ issues: [], name: "U2" }]);

		const human = placeIssue(gated, { issue: "1", reason: "decide", target: "human" });
		assert.deepEqual(human.gated, []);
		assert.deepEqual(human.human, [{ issue: "1", reason: "decide" }]);
	});

	test("addRule appends a rule and upserts on the same issue set regardless of order", () => {
		const withRule = addRule(base(), { issues: ["2", "1"], name: "R1", reason: "same file" });
		assert.deepEqual(withRule.serialized, [
			{ issues: ["2", "1"], name: "R1", reason: "same file" },
		]);

		const upserted = addRule(withRule, { issues: ["1", "2"], reason: "updated reason" });
		assert.deepEqual(upserted.serialized, [{ issues: ["1", "2"], reason: "updated reason" }]);

		const second = addRule(upserted, { issues: ["3"], reason: "other" });
		assert.equal(second.serialized.length, 2);
	});

	test("addRule rejects duplicate issues", () => {
		assert.throws(() => {
			addRule(base(), { issues: ["1", "1"], reason: "x" });
		}, /contains duplicates/u);
	});

	test("removeIssue removes an issue from every placement and throws when unplaced", () => {
		const start: QueueManifest = {
			...base(),
			gated: [{ issue: "2", reason: "waiting" }],
			sequences: [{ issues: ["1", "2"], name: "U2" }],
		};
		const next = removeIssue(start, "2");

		assert.deepEqual(next.sequences, [{ issues: ["1"], name: "U2" }]);
		assert.deepEqual(next.gated, []);

		assert.throws(() => {
			removeIssue(next, "2");
		}, /not placed/u);
	});

	test("deleteRule retires every rule carrying the name and refuses an unknown one", () => {
		const start: QueueManifest = {
			...base(),
			serialized: [
				{ issues: ["295", "386"], name: "R2", reason: "same file" },
				{ issues: ["432", "292", "293"], name: "R2", reason: "same file" },
				{ issues: ["1", "2"], reason: "unnamed" },
			],
		};

		/*
		 * One name can cover two disjoint issue sets (that is why the name is not the add key), so a
		 * retire by name removes every entry carrying it — retiring "R2" means both halves.
		 */
		const next = deleteRule(start, { name: "R2" });
		assert.deepEqual(next.serialized, [{ issues: ["1", "2"], reason: "unnamed" }]);

		assert.throws(() => {
			deleteRule(start, { name: "R9" });
		}, /No serialization rule matches name "R9"/u);
	});

	test("deleteRule matches an exact issue set, optionally narrowed by name", () => {
		const start: QueueManifest = {
			...base(),
			serialized: [
				{ issues: ["295", "386"], name: "R2", reason: "same file" },
				{ issues: ["1", "2"], reason: "unnamed" },
			],
		};

		// The sorted issue set is the key regardless of order, so an unnamed rule is deletable by set.
		const bySet = deleteRule(start, { issues: ["2", "1"] });
		assert.deepEqual(bySet.serialized, [
			{ issues: ["295", "386"], name: "R2", reason: "same file" },
		]);

		const byNameAndSet = deleteRule(start, { issues: ["386", "295"], name: "R2" });
		assert.deepEqual(byNameAndSet.serialized, [{ issues: ["1", "2"], reason: "unnamed" }]);

		// A set that matches a differently-named rule does not satisfy a name+narrowed request.
		assert.throws(() => {
			deleteRule(start, { issues: ["386"] });
		}, /No serialization rule matches issues \(386\)/u);

		assert.throws(() => {
			deleteRule(base(), { issues: ["1", "1"] });
		}, /contains duplicates/u);
		assert.throws(() => {
			deleteRule(base(), {});
		}, /requires --name/u);
	});

	test("matchingRules reports what a delete would remove, before removing it", () => {
		const start: QueueManifest = {
			...base(),
			serialized: [
				{ issues: ["295", "386"], name: "R2", reason: "same file" },
				{ issues: ["432", "292", "293"], name: "R2", reason: "same file" },
			],
		};

		assert.deepEqual(matchingRules(start, { name: "R2" }), start.serialized);
		assert.deepEqual(matchingRules(start, { issues: ["386", "295"], name: "R2" }), [
			start.serialized[0],
		]);
		assert.deepEqual(matchingRules(start, { name: "R9" }), []);
	});

	test("midChainInsertionConflict names the first dispatched member after the insertion", () => {
		const start: QueueManifest = {
			...base(),
			sequences: [{ issues: ["10", "11", "12"], name: "progression-work" }],
		};
		const inserted = addToSequence(start, {
			after: "10",
			issue: "99",
			sequence: "progression-work",
		});
		assert.deepEqual(inserted.sequences[0]?.issues, ["10", "99", "11", "12"]);

		const conflict = midChainInsertionConflict({
			isDispatched: (member) => member === "12",
			issue: "99",
			manifest: inserted,
		});
		assert.match(
			conflict ?? "",
			/#12 of batch "progression-work" has already been dispatched/u,
		);
		assert.match(conflict ?? "", /omit --after/u);

		// A dispatched member before the insertion point does not block; one after it does.
		assert.equal(
			midChainInsertionConflict({
				isDispatched: (member) => member === "10",
				issue: "99",
				manifest: inserted,
			}),
			undefined,
		);
		assert.match(
			midChainInsertionConflict({
				isDispatched: (member) => member === "11",
				issue: "99",
				manifest: inserted,
			}) ?? "",
			/#11 of batch/u,
		);

		// An issue placed outside any sequence (gated/human) never chains behind a dispatched member.
		assert.equal(
			midChainInsertionConflict({ isDispatched: () => true, issue: "99", manifest: base() }),
			undefined,
		);
	});

	test("add → retire → re-declare narrower → drift zero", () => {
		const withRule = (issues: ReadonlyArray<string>): QueueManifest => ({
			...base(),
			sequences: [
				{ issues: ["201", "171"], name: "matchmaking-session-work" },
				{ issues: ["423"], name: "ranked-policy-work" },
			],
			serialized: [{ issues: [...issues], name: "R10", reason: "ranked rating state" }],
		});

		// The stale clique drifts: 171 and 201 share one batch, so position already serializes them.
		const stale = computeQueueView(
			withRule(["423", "171", "201"]),
			live(issue("171"), issue("201"), issue("423")),
		);
		assert.equal(stale.drift.length, 1);
		assert.match(stale.drift[0] ?? "", /rule "R10" couples #171 and #201/u);

		// Retire the clique and re-declare the cross-batch intent pairwise; the drift returns to zero.
		const retired = deleteRule(withRule(["423", "171", "201"]), { name: "R10" });
		assert.deepEqual(retired.serialized, []);
		const narrowed = addRule(retired, {
			issues: ["423", "171"],
			name: "R10",
			reason: "ranked rating state",
		});
		const crossOnly = addRule(narrowed, {
			issues: ["423", "201"],
			name: "R16",
			reason: "ranked rating state",
		});
		const clean = computeQueueView(crossOnly, live(issue("171"), issue("201"), issue("423")));
		assert.deepEqual(clean.drift, []);
	});
});
