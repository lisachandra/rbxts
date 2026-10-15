/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { CliOptions } from "../cli.js";
import { worktreePathForBranch } from "../runtime.js";
import { gitStub, registerTestHooks, tmpRoot } from "../test-helpers.js";
import {
	type CleanSelections,
	removeIssueWorktree,
	selectIntegrations,
	selectIssueWorktrees,
} from "./clean.js";
import type { LiveIssue, LiveQueueState } from "./live.js";
import { emptyQueueManifest, type QueueManifest } from "./manifest.js";

registerTestHooks();

const off: CleanSelections = {
	all: false,
	closed: false,
	dropBranch: false,
	integrations: false,
	landed: false,
	pruneGit: false,
	pushAndDelete: false,
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

	test("--batch narrows the selection to one batch's members", () => {
		const mine = worktree("11");
		const other = worktree("12");
		const result = selectIssueWorktrees({
			live: live(issue("11", { state: "CLOSED" }), issue("12", { state: "CLOSED" })),
			manifest: manifest({
				sequences: [
					{ issues: ["11"], name: "chat-work" },
					{ issues: ["12"], name: "vfx-work" },
				],
			}),
			selections: { ...off, batch: "chat-work", closed: true },
			worktrees: [mine, other],
		});

		assert.deepEqual(
			result.remove.map((entry) => entry.issue),
			["11"],
			"only the named batch is a candidate",
		);
		assert.equal(result.kept[0]?.path, other.path);
		assert.match(result.kept[0]?.reason ?? "", /not in batch "chat-work"/u);
	});

	test("--batch keeps an unplaced worktree even when --stale is on", () => {
		const unplaced = worktree("13");
		const result = selectIssueWorktrees({
			live: live(),
			manifest: manifest({ sequences: [{ issues: ["11"], name: "chat-work" }] }),
			selections: { ...off, batch: "chat-work", stale: true },
			worktrees: [unplaced],
		});

		assert.deepEqual(result.remove, [], "--stale does not override --batch");
		assert.match(result.kept[0]?.reason ?? "", /not in batch "chat-work"/u);
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

describe("queue clean --push-and-delete", () => {
	/** Records every git invocation the removal path makes, in order. */
	function recordingGit(): Array<Array<string>> {
		const calls: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				calls.push([...args]);
				return "";
			},
		});
		return calls;
	}

	/**
	 * A real (empty) directory: `removable` reads it as clean and the removal path runs for real,
	 * rather than short-circuiting on a path that is already gone.
	 */
	function candidate(number: string) {
		const path = join(tmpRoot, "push-and-delete", number);
		mkdirSync(path, { recursive: true });
		return { batch: undefined, issue: number, path, reason: "closed" };
	}

	test("pushes the issue branch before the worktree is removed", () => {
		/*
		 * The ordering is the property that matters: the whole point is that the work outlives the
		 * worktree, so a removal that ran first would lose the thing being protected.
		 */
		const calls = recordingGit();

		const line = removeIssueWorktree({ dryRun: false } as CliOptions, candidate("7"), {
			...off,
			pushAndDelete: true,
		});

		const push = calls.findIndex((args) => args[0] === "push");
		const remove = calls.findIndex((args) => args[0] === "worktree" && args[1] === "remove");
		assert.notEqual(push, -1, "the branch was pushed");
		assert.notEqual(remove, -1, "the worktree was removed");
		assert.ok(push < remove, "push ran before the removal");
		assert.match(line, /pushed sandcastle\/issue-7/u);
	});

	test("does not push when the selection is off", () => {
		const calls = recordingGit();

		removeIssueWorktree({ dryRun: false } as CliOptions, candidate("8"), off);

		assert.equal(
			calls.some((args) => args[0] === "push"),
			false,
			"no push without the flag",
		);
	});
});
