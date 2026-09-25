/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";
import { computeQueueView } from "./render.js";
import { ruleConflicts, selectNextBatch, sequenceTail } from "./schedule.js";
import type { ScheduleDecision } from "./schedule.js";

registerTestHooks();

function issue(number: string, overrides: Partial<LiveIssue> = {}): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: overrides.openBlockers ?? [],
		ready: overrides.ready ?? true,
		state: overrides.state ?? "OPEN",
		title: overrides.title ?? `Issue ${number}`,
		wayfinder: overrides.wayfinder ?? false,
	};
}

function live(...entries: Array<LiveIssue>): LiveQueueState {
	const issues = new Map<string, LiveIssue>();
	for (const entry of entries) {
		issues.set(entry.number, entry);
	}

	return { issues, readyIssues: [], truncated: false };
}

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function plan(
	queue: QueueManifest,
	state: LiveQueueState,
	params: { batch?: string; seen?: Array<string> } = {},
): ScheduleDecision {
	return selectNextBatch({
		...(params.batch === undefined ? {} : { batch: params.batch }),
		manifest: queue,
		seen: new Set(params.seen),
		view: computeQueueView(queue, state, { strictGates: true }),
	});
}

function reasonOf(decision: ScheduleDecision): string {
	return decision.kind === "done" ? decision.reason : `ran ${decision.name}`;
}

describe("queue scheduling", () => {
	test("dispatches the first READY sequence, then the next once it is dispatched", () => {
		const queue = manifest({
			sequences: [
				{ issues: ["1", "2"], name: "U2" },
				{ issues: ["3"], name: "U3" },
			],
		});
		const state = live(issue("1"), issue("2"), issue("3"));

		assert.deepEqual(plan(queue, state), {
			issues: ["1", "2"],
			kind: "sequence",
			name: "U2",
		});
		assert.deepEqual(plan(queue, state, { seen: ["1", "2"] }), {
			issues: ["3"],
			kind: "sequence",
			name: "U3",
		});
	});

	test("reports why nothing can fire rather than running a GATED sequence", () => {
		const queue = manifest({ sequences: [{ issues: ["1"], name: "U2" }] });
		const decision = plan(queue, live(issue("1", { ready: false })));

		assert.equal(decision.kind, "done");
		assert.match(reasonOf(decision), /missing ready-for-agent/u);
	});

	test("a serialization rule keeps a sequence apart from a dispatched issue", () => {
		const queue = manifest({
			sequences: [
				{ issues: ["1"], name: "U2" },
				{ issues: ["2"], name: "U3" },
			],
			serialized: [{ issues: ["1", "2"], name: "R1", reason: "same file" }],
		});
		const state = live(issue("1"), issue("2"));

		assert.deepEqual(plan(queue, state), { issues: ["1"], kind: "sequence", name: "U2" });

		const next = plan(queue, state, { seen: ["1"] });
		assert.equal(next.kind, "done");
		assert.match(reasonOf(next), /serialization rule/u);
	});

	test("--batch pins dispatch to one sequence and reports an unknown name", () => {
		const queue = manifest({
			sequences: [
				{ issues: ["1"], name: "U2" },
				{ issues: ["2"], name: "U3" },
			],
		});
		const state = live(issue("1"), issue("2"));

		assert.deepEqual(plan(queue, state, { batch: "U3" }), {
			issues: ["2"],
			kind: "sequence",
			name: "U3",
		});
		assert.equal(
			reasonOf(plan(queue, state, { batch: "missing" })),
			'no sequence named "missing"',
		);
	});

	test("ruleConflicts reports candidate members shared with dispatched issues", () => {
		const queue = manifest({ serialized: [{ issues: ["1", "2"], reason: "same file" }] });

		assert.deepEqual(ruleConflicts(queue, new Set(["2", "3"]), new Set(["1"])), ["2"]);
		assert.deepEqual(ruleConflicts(queue, new Set(["3"]), new Set(["1"])), []);
	});

	test("sequenceTail returns the issue a merge consumes", () => {
		assert.equal(sequenceTail(["1", "2"]), "2");
		assert.equal(sequenceTail([]), "");
	});
});
