/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { registerTestHooks } from "../test-helpers.js";
import { worktreePathForBranch } from "../worktree.js";
import { type CleanSelections, selectIntegrations, selectIssueWorktrees } from "./clean.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";

registerTestHooks();

const off: CleanSelections = {
	all: false,
	closed: false,
	dropBranch: false,
	integrations: false,
	landed: false,
	reset: false,
	stale: false,
};

function issue(number: string, overrides: Partial<LiveIssue> = {}): LiveIssue {
	return {
		found: true,
		number,
		openBlockers: [],
		ready: true,
		state: overrides.state ?? "OPEN",
		title: `Issue ${number}`,
		wayfinder: false,
		...overrides,
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
	return { ...emptyQueueManifest(), updatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

/** A registered worktree entry for `sandcastle/issue-<n>` at its canonical runner path. */
function worktree(issueNumber: string): { branch: string; path: string } {
	const branch = `sandcastle/issue-${issueNumber}`;
	return { branch, path: worktreePathForBranch(branch) };
}

describe("queue clean", () => {
	test("selects a CLOSED issue's worktree under --closed and keeps the rest", () => {
		const closed = worktree("5");
		const open = worktree("6");
		const result = selectIssueWorktrees({
			live: live(issue("5", { state: "CLOSED" }), issue("6")),
			manifest: manifest({ sequences: [{ issues: ["5", "6"], name: "U2" }] }),
			selections: { ...off, closed: true },
			worktrees: [closed, open],
		});

		assert.deepEqual(
			result.remove.map((entry) => entry.issue),
			["5"],
		);
		assert.equal(result.remove[0]?.reason, "closed");
		assert.deepEqual(
			result.kept.map((entry) => entry.path),
			[open.path],
			"an open, unapproved issue keeps its worktree",
		);
	});

	test("keeps an open, unapproved issue even when every selection is on", () => {
		const open = worktree("7");
		const result = selectIssueWorktrees({
			live: live(issue("7")),
			manifest: manifest({ sequences: [{ issues: ["7"], name: "U2" }] }),
			selections: { ...off, all: true, closed: true, landed: true, stale: true },
			worktrees: [open],
		});

		assert.deepEqual(result.remove, []);
		assert.match(result.kept[0]?.reason ?? "", /still open and not approved/u);
	});

	test("--stale selects a worktree with no manifest placement and no live issue", () => {
		const orphan = worktree("9");
		const result = selectIssueWorktrees({
			live: live(issue("5", { state: "CLOSED" })),
			manifest: manifest({ sequences: [{ issues: ["5"], name: "U2" }] }),
			selections: { ...off, stale: true },
			worktrees: [orphan],
		});

		assert.deepEqual(
			result.remove.map((entry) => entry.issue),
			["9"],
		);
	});

	test("ignores a branch that is not a sandcastle issue worktree", () => {
		const result = selectIssueWorktrees({
			live: live(),
			manifest: manifest(),
			selections: { ...off, all: true, closed: true, landed: true, stale: true },
			worktrees: [{ branch: "feature/mine", path: "D:/elsewhere" }],
		});

		assert.deepEqual(result.remove, []);
	});

	test("ignores a runner branch registered at a foreign path", () => {
		const result = selectIssueWorktrees({
			live: live(issue("5", { state: "CLOSED" })),
			manifest: manifest(),
			selections: { ...off, closed: true },
			worktrees: [{ branch: "sandcastle/issue-5", path: "D:/handmade" }],
		});

		assert.deepEqual(result.remove, []);
		assert.match(result.kept[0]?.reason ?? "", /not a runner-managed worktree path/u);
	});

	test("matches the path git prints for a worktree, with forward slashes", () => {
		const branch = "sandcastle/issue-8";
		const asGitPrintsIt = worktreePathForBranch(branch).replaceAll("\\", "/");
		const result = selectIssueWorktrees({
			live: live(issue("8", { state: "CLOSED" })),
			manifest: manifest(),
			selections: { ...off, closed: true },
			worktrees: [{ branch, path: asGitPrintsIt }],
		});

		// git prints D:/a/b where node builds D:\\a\\b; a raw comparison kept every worktree.
		assert.deepEqual(
			result.remove.map((entry) => entry.issue),
			["8"],
		);
	});

	test("selects only terminal integrations, and only when asked", () => {
		const statuses: Record<string, string> = {
			"done-work": "ready-for-human-merge",
			"live-work": "merging",
		};
		const result = selectIntegrations({
			names: ["done-work", "live-work"],
			readManifest: (name) => ({ status: statuses[name] ?? "unknown" }),
			selections: { ...off, integrations: true, reset: true },
		});

		assert.deepEqual(
			result.remove.map((entry) => entry.name),
			["done-work"],
		);
		assert.equal(result.remove[0]?.reset, true);
		assert.match(result.kept[0]?.reason ?? "", /composition is merging/u);
	});

	test("selects no integrations when --integration-worktrees is absent", () => {
		const result = selectIntegrations({
			names: ["done-work"],
			readManifest: () => ({ status: "ready-for-human-merge" }),
			selections: off,
		});

		assert.deepEqual(result.remove, []);
	});
});
