/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { applyBootstrap, proposeBootstrap, scopeOf } from "./bootstrap.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";

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

function live(
	entries: Array<LiveIssue>,
	ready: Array<{ number: string; title: string }>,
): LiveQueueState {
	const issues = new Map<string, LiveIssue>();
	for (const entry of entries) {
		issues.set(entry.number, entry);
	}

	return { issues, readyIssues: ready, truncated: false };
}

function manifest(overrides: Partial<QueueManifest> = {}): QueueManifest {
	return {
		...emptyQueueManifest(),
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("queue bootstrap proposal", () => {
	test("scopeOf reads the conventional-commit scope and defaults to unscoped", () => {
		assert.equal(scopeOf("feat(sandcastle): add queue run"), "sandcastle");
		assert.equal(scopeOf("fix(ui/button): square corners"), "ui/button");
		assert.equal(scopeOf("Chore without a scope"), "unscoped");
	});

	test("groups the backlog by scope, sorted by issue number", () => {
		const proposal = proposeBootstrap({
			live: live(
				[issue("12"), issue("3"), issue("9")],
				[
					{ number: "3", title: "feat(core): three" },
					{ number: "9", title: "feat(core): nine" },
					{ number: "12", title: "fix(sandcastle): twelve" },
				],
			),
			manifest: manifest(),
		});

		assert.deepEqual(proposal.sequences, [
			{ issues: ["3", "9"], name: "core-work", notes: "bootstrap proposal" },
			{ issues: ["12"], name: "sandcastle-work", notes: "bootstrap proposal" },
		]);
		assert.deepEqual(proposal.gated, []);
		assert.deepEqual(proposal.human, []);
	});

	test("gates blocked issues, hands wayfinder tickets to a human, and skips placed ones", () => {
		const proposal = proposeBootstrap({
			live: live(
				[issue("1", { openBlockers: ["8"] }), issue("2", { wayfinder: true }), issue("3")],
				[
					{ number: "1", title: "feat(core): blocked" },
					{ number: "2", title: "wayfinder(sandcastle): decide" },
					{ number: "3", title: "feat(core): placed already" },
				],
			),
			manifest: manifest({ sequences: [{ issues: ["3"], name: "core" }] }),
		});

		assert.deepEqual(proposal.gated, [{ issue: "1", reason: "blocked by open #8" }]);
		assert.deepEqual(proposal.human, [
			{ issue: "2", reason: "wayfinder ticket — human decision session" },
		]);
		assert.deepEqual(proposal.sequences, []);
	});

	test("applyBootstrap merges the proposal without disturbing existing entries", () => {
		const start = manifest({
			gated: [{ issue: "7", reason: "waiting" }],
			sequences: [{ issues: ["1"], name: "core" }],
		});
		const next = applyBootstrap(start, {
			gated: [{ issue: "2", reason: "blocked" }],
			human: [],
			promotions: [],
			sequences: [{ issues: ["5"], name: "sandcastle-work" }],
		});

		assert.deepEqual(next.sequences, [
			{ issues: ["1"], name: "core" },
			{ issues: ["5"], name: "sandcastle-work" },
		]);
		assert.deepEqual(next.gated, [
			{ issue: "7", reason: "waiting" },
			{ issue: "2", reason: "blocked" },
		]);
		assert.equal(next.updatedAt, start.updatedAt);
	});
});
