/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";
import { computeQueueView, renderQueueText } from "./render.js";

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

function liveTruncated(...entries: Array<LiveIssue>): LiveQueueState {
	return { ...live(...entries), truncated: true };
}

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("queue view computation", () => {
	test("a sequence is READY when every member is open, ready, and unblocked", () => {
		const view = computeQueueView(
			manifest({ sequences: [{ issues: ["1", "2"], name: "U2" }] }),
			live(issue("1"), issue("2")),
		);

		const sequence = view.sequences[0];
		assert.ok(sequence !== undefined);
		assert.equal(sequence.status, "READY");
		assert.deepEqual(sequence.reasons, []);
	});

	test("a sequence is GATED with reasons for closed, unready, or externally blocked members", () => {
		const view = computeQueueView(
			manifest({ sequences: [{ issues: ["1", "2", "3"], name: "U2" }] }),
			live(
				issue("1", { state: "CLOSED" }),
				issue("2", { ready: false }),
				issue("3", { openBlockers: ["9"] }),
				issue("9"),
			),
		);

		const sequence = view.sequences[0];
		assert.ok(sequence !== undefined);
		assert.equal(sequence.status, "GATED");
		assert.deepEqual(sequence.reasons, [
			"#1 closed",
			"#2 missing ready-for-agent",
			"#3 blocked by open #9",
		]);
	});

	test("intra-sequence blockers do not gate a sequence", () => {
		const view = computeQueueView(
			manifest({ sequences: [{ issues: ["1", "2"], name: "U2" }] }),
			live(issue("1", { openBlockers: ["2"] }), issue("2")),
		);

		const sequence = view.sequences[0];
		assert.ok(sequence !== undefined);
		assert.equal(sequence.status, "READY");
	});

	test("gated entries report promotion readiness", () => {
		const view = computeQueueView(
			manifest({
				gated: [
					{ issue: "1", reason: "waiting on review" },
					{ issue: "2", reason: "blocked" },
				],
			}),
			live(issue("1"), issue("2", { openBlockers: ["3"] }), issue("3")),
		);

		const first = view.gated[0];
		assert.ok(first !== undefined);
		assert.equal(first.promotable, true);

		const second = view.gated[1];
		assert.ok(second !== undefined);
		assert.equal(second.promotable, false);
	});

	test("flags unplaced ready issues as drift, ignoring wayfinder-labeled ones", () => {
		const state = live(issue("5"), issue("6", { wayfinder: true }));
		state.readyIssues = [
			{ number: "5", title: "Five" },
			{ number: "6", title: "Six" },
		];

		const view = computeQueueView(manifest(), state);

		assert.deepEqual(view.unplaced, [{ number: "5", title: "Five" }]);
		assert.deepEqual(view.drift, [
			"#5 is open and ready-for-agent but not placed in the queue",
		]);
	});

	test("flags closed-but-referenced and missing issues as drift", () => {
		const view = computeQueueView(
			manifest({
				gated: [{ issue: "3", reason: "waiting" }],
				human: [{ issue: "4", reason: "decide" }],
				sequences: [{ issues: ["1", "2"], name: "U2" }],
			}),
			live(
				issue("1", { state: "CLOSED" }),
				issue("3", { state: "CLOSED" }),
				issue("4", { state: "CLOSED" }),
			),
		);

		assert.deepEqual(view.closed, [
			{ issue: "1", where: 'sequence "U2"' },
			{ issue: "3", where: "gated" },
		]);
		assert.deepEqual(view.missing, [{ issue: "2", where: 'sequence "U2"' }]);
		assert.equal(view.drift.length, 3);
	});

	test("human entries are never flagged as closed", () => {
		const view = computeQueueView(
			manifest({ human: [{ issue: "4", reason: "decide" }] }),
			live(issue("4", { state: "CLOSED" })),
		);

		assert.deepEqual(view.closed, []);
		assert.deepEqual(view.drift, []);
	});

	test("a truncated issue list reports referenced issues as unscanned, not missing", () => {
		const view = computeQueueView(
			manifest({ sequences: [{ issues: ["1", "2"], name: "U2" }] }),
			liveTruncated(issue("1")),
		);

		assert.deepEqual(view.missing, []);
		assert.deepEqual(view.unscanned, [{ issue: "2", where: 'sequence "U2"' }]);
		assert.equal(view.drift.length, 1);
		assert.match(view.drift[0] ?? "", /not scanned/u);
		assert.match(renderQueueText(view), /Unscanned \(issue list truncated\):/u);
	});

	test("strict gates report a promotable gate as drift", () => {
		const queue = manifest({ gated: [{ issue: "1", reason: "waiting on review" }] });
		const state = live(issue("1"));

		assert.deepEqual(computeQueueView(queue, state).drift, []);
		assert.deepEqual(computeQueueView(queue, state, { strictGates: true }).drift, [
			"#1 is gated but promotable — promote it or re-gate it",
		]);
	});
});

describe("queue text rendering", () => {
	test("renders sequences, rules, gated, human, and drift sections", () => {
		const view = computeQueueView(
			manifest({
				gated: [{ issue: "3", reason: "waiting on design" }],
				human: [{ issue: "4", reason: "needs a human decision" }],
				sequences: [
					{
						issues: ["1"],
						mergeName: "sandcastle/issue-1",
						name: "U2",
						notes: "first batch",
					},
				],
				serialized: [{ issues: ["1", "3"], name: "R1", reason: "same file" }],
			}),
			live(issue("1"), issue("3"), issue("4", { ready: false })),
		);

		const text = renderQueueText(view);
		assert.match(text, /Sandcastle queue \(live\)/u);
		assert.match(text, /Manifest updated: 2026-01-01T00:00:00\.000Z/u);
		assert.match(text, /✓ READY\s+U2 \(1 issue\(s\)\)/u);
		assert.match(text, /merge: sandcastle\/issue-1/u);
		assert.match(text, /· first batch/u);
		assert.match(text, /Serialization rules:/u);
		assert.match(text, /R1 \(1,3\) — same file/u);
		assert.match(text, /Gated:/u);
		assert.match(text, /#3 — waiting on design/u);
		assert.match(text, /Promotable now/u);
		assert.match(text, /Human \(never queued\):/u);
		assert.match(text, /#4 \(OPEN\) — needs a human decision/u);
	});

	test("renders a batch label, member roles, notes, and an unmet run-order gate", () => {
		const view = computeQueueView(
			manifest({
				gated: [{ issue: "9", joins: "V", reason: "waiting on V" }],
				sequences: [
					{
						afterMerge: "audio-seam-work",
						issues: ["1", "2"],
						name: "V",
						notes: "vfx surface · one chain",
						roles: { "1": "engine sounds", "2": "scoring id" },
						title: "vfx surface",
					},
				],
			}),
			live(issue("1"), issue("2"), issue("9")),
			{ gates: new Map([["audio-seam-work", 'waiting on integration "audio-seam-work"']]) },
		);

		const text = renderQueueText(view);
		assert.match(text, /V — vfx surface \(2 issue\(s\)\)/u);
		assert.match(text, /#1 engine sounds · #2 scoring id/u);
		assert.match(text, /⏸ GATED/u);
		assert.match(text, /waiting on integration "audio-seam-work"/u);
		assert.match(text, /#9 \(joins V\) — waiting on V/u);
	});

	test("an empty queue renders a never-updated header with no drift", () => {
		const text = renderQueueText(computeQueueView(manifest({ updatedAt: "" }), live()));

		assert.match(text, /Manifest updated: never/u);
		assert.ok(!text.includes("Drift:"));
	});

	test("a promotable gate renders as a hint without being drift", () => {
		const view = computeQueueView(
			manifest({ gated: [{ issue: "1", reason: "waiting" }] }),
			live(issue("1")),
		);

		const text = renderQueueText(view);
		assert.match(text, /Promotable now/u);
		assert.ok(!text.includes("Drift:"));
	});
});
