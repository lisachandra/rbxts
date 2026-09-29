/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { emptyQueueManifest, locateIssue, type QueueManifest } from "./manifest.js";
import { addRule, addToSequence, defineSequence, placeIssue, removeIssue } from "./mutations.js";

registerTestHooks();

function base(): QueueManifest {
	return { ...emptyQueueManifest(), updatedAt: "2026-01-01T00:00:00.000Z" };
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
});
