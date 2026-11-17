import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import {
	branchTip,
	checkoutBranch,
	commitExists,
	countNewCommits,
	ensureLocalBranch,
	issueBranch,
	registeredWorktrees,
	resolveCommit,
} from "./git.js";
import { io } from "./runtime.js";
import { gitStub, registerTestHooks, tmpRoot } from "./test-helpers.js";

registerTestHooks();

describe("git helpers with stubs", () => {
	test("resolveCommit, commitExists, registeredWorktrees, checkoutBranch", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-parse" && args[1] === "--verify") {
					return "0123456789abcdef";
				}

				if (args[0] === "cat-file") {
					return "";
				}

				if (args[0] === "worktree" && args[1] === "list") {
					return [
						"worktree /tmp/a",
						"branch refs/heads/feature",
						"",
						"worktree /tmp/b",
						"",
					].join("\n");
				}

				if (args[0] === "-C" && args[2] === "rev-parse") {
					return ".git";
				}

				if (args[0] === "-C" && args[2] === "symbolic-ref") {
					return "feature";
				}

				return "";
			},
		});

		assert.equal(resolveCommit("HEAD"), "0123456789abcdef");
		assert.equal(commitExists("0123456789abcdef"), true);
		assert.deepEqual(registeredWorktrees(), [
			{ branch: "feature", path: "/tmp/a" },
			{ branch: undefined, path: "/tmp/b" },
		]);

		const branchPath = join(tmpRoot, "checkout-branch");
		mkdirSync(branchPath, { recursive: true });
		assert.equal(checkoutBranch(branchPath), "feature");
		assert.equal(checkoutBranch(join(tmpRoot, "missing-path")), undefined);
		rmSync(branchPath, { force: true, recursive: true });
	});

	test("resolveCommit rejects non-hex output", () => {
		gitStub({
			file: () => "not-a-commit",
		});
		assert.throws(() => resolveCommit("HEAD"), /did not resolve to a commit/);
	});

	test("countNewCommits returns 0 on failure", () => {
		gitStub({
			file: () => {
				throw new Error("bad");
			},
		});

		assert.equal(countNewCommits(tmpRoot, "main"), 0);

		gitStub({ file: () => "4" });
		assert.equal(countNewCommits(tmpRoot, "main"), 4);
	});

	test("countNewCommits passes the base ref as argv and excludes the plans path", () => {
		/*
		 * The design phase commits the plan, so without the exclusion a plan-only branch would read as
		 * implemented work and start a review of nothing.
		 *
		 * The ref is asserted as an argument rather than as part of a command string: that is what
		 * stops a base ref read from a state file from changing the command at all.
		 */
		let captured: ReadonlyArray<string> = [];
		io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
			assert.equal(command, "git");
			captured = Array.isArray(args) ? args : [];
			return "0";
		}) as unknown as typeof io.execFileSync;

		assert.equal(countNewCommits(tmpRoot, "main"), 0);
		assert.ok(captured.includes("main"));
		assert.ok(captured.some((arg) => arg === ":(exclude).sandcastle/plans"));
	});
});

test("issueBranch formats string and numeric issue numbers", () => {
	assert.equal(issueBranch("123"), "sandcastle/issue-123");
	assert.equal(issueBranch(456), "sandcastle/issue-456");
});

test("issueBranch rejects invalid or non-digit issue numbers", () => {
	assert.throws(() => issueBranch("abc"), /Invalid issue number/);
	assert.throws(() => issueBranch(""), /Invalid issue number/);
	assert.throws(() => issueBranch(-1), /Invalid issue number/);
	assert.throws(() => issueBranch("1.2"), /Invalid issue number/);
});

describe("branchTip", () => {
	test("prefers the local branch", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "0123456789abcdef";
				}

				return "";
			},
		});

		assert.deepEqual(branchTip("sandcastle/issue-7"), {
			commit: "0123456789abcdef",
			local: true,
			ref: "sandcastle/issue-7",
		});
	});

	test("falls back to origin when only the remote has the branch", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "show-ref" && args.includes("refs/heads/sandcastle/issue-7")) {
					throw new Error("no local branch");
				}

				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "0123456789abcdef";
				}

				return "";
			},
		});

		assert.deepEqual(
			branchTip("sandcastle/issue-7"),
			{ commit: "0123456789abcdef", local: false, ref: "origin/sandcastle/issue-7" },
			"a pushed-and-dropped branch still resolves",
		);
	});

	test("answers undefined when neither ref exists", () => {
		gitStub({
			file: () => {
				throw new Error("no such ref");
			},
		});

		assert.equal(branchTip("sandcastle/issue-7"), undefined);
	});

	test("ensureLocalBranch tracks from origin, and is a no-op when it cannot", () => {
		const calls: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				calls.push([...args]);
				if (args[0] === "show-ref" && args.includes("refs/heads/sandcastle/issue-7")) {
					throw new Error("no local branch");
				}

				if (args[0] === "show-ref") {
					return "";
				}

				return "";
			},
		});

		assert.equal(ensureLocalBranch("sandcastle/issue-7"), true);
		assert.deepEqual(
			calls.find((args) => args[0] === "branch"),
			["branch", "--track", "sandcastle/issue-7", "origin/sandcastle/issue-7"],
		);

		gitStub({
			file: () => {
				throw new Error("nothing resolves");
			},
		});
		assert.equal(
			ensureLocalBranch("sandcastle/issue-8"),
			false,
			"no remote branch, no restore",
		);
	});
});
