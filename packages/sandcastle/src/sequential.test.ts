/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { markerPath } from "./markers.js";
import { worktreePathForBranch } from "./runtime.js";
import { reclaimMemberWorktree, runSequentialIssues } from "./sequential.js";
import { writeState } from "./state.js";
import {
	cleanupIssueArtifacts,
	ExitError,
	gitStub,
	makeState,
	registerTestHooks,
	repositoryRoot,
	stubExit,
	stubRun,
	tmpRoot,
	uniqueIssue,
	writePlan,
} from "./test-helpers.js";

registerTestHooks();

describe("sequential issue workflow", () => {
	test("runSequentialIssues empty throws; blocked and failed exit", async () => {
		await assert.rejects(
			async () => runSequentialIssues([], "main", "m", "low", "dirac", false),
			/At least one/,
		);

		const issue = uniqueIssue();
		// Resume-skip checks the default sandcastle worktree path when no --worktree is supplied.
		const worktree = join(
			repositoryRoot,
			".sandcastle",
			"worktrees",
			`sandcastle-issue-${issue}`,
		);
		/*
		 * Deliberately absent: the worktree is what a cleanup removes, and the skip has to work without
		 * it. Recreating one here would be the bug this pins — a re-fired batch re-creating a full
		 * checkout for every member it only means to skip.
		 */
		rmSync(worktree, { force: true, recursive: true });
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const calls: Array<Array<string>> = [];
		const codes = stubExit();
		gitStub({
			file: (args) => {
				calls.push([...args]);
				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [], title: "title" });
				}

				return "";
			},
		});

		// Resume skip path for completed issue, then no blocked/failed.
		await runSequentialIssues([issue], "main", "test-model", "low", "dirac", true);
		assert.deepEqual(codes, []);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "add"),
			false,
			"a skipped member must not have its worktree recreated",
		);

		// Failed path.
		const failingIssue = uniqueIssue();
		gitStub({
			file: () => {
				throw new Error("boom");
			},
			sync: () => {
				throw new Error("boom");
			},
		});
		await assert.rejects(
			async () => runSequentialIssues([failingIssue], "main", "m", "low", "dirac", false),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSequentialIssues aborts on blocked review", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `seq-block-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");

		const codes = stubExit();
		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${worktree}\nbranch refs/heads/sandcastle/issue-${issue}\n`;
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				if (args[0] === "status") {
					return "";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: BLOCKED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [], title: "title" });
				}

				return "";
			},
		});
		stubRun(
			{
				commits: [{ sha: "c1" }],
				stdout: "ok",
			},
			[
				markerPath(`${issue}.design`),
				markerPath(`${issue}.implement`),
				markerPath(`${issue}.review`),
			],
		);

		await assert.rejects(
			async () =>
				runSequentialIssues([issue], "main", "model", "low", "dirac", false, { worktree }),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);
		assert.equal(codes.at(-1), 1);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("skips a landed member whose branch survives only on origin, and restores it", async () => {
		const issue = uniqueIssue();
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const calls: Array<Array<string>> = [];
		stubExit();
		gitStub({
			file: (args) => {
				calls.push([...args]);
				// The local branch is gone; only `origin/<branch>` resolves.
				if (
					args[0] === "show-ref" &&
					args.includes(`refs/heads/sandcastle/issue-${issue}`)
				) {
					throw new Error("no local branch");
				}

				if (args[0] === "show-ref") {
					return "";
				}

				if (args[0] === "rev-parse") {
					return "abc1234567890";
				}

				return "";
			},
			sync: (command) => {
				if (command.includes("comments")) {
					return JSON.stringify({
						comments: [{ body: "Sandcastle-Review: APPROVED" }],
					});
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				return JSON.stringify({ labels: [], title: "title" });
			},
		});

		await runSequentialIssues([issue], "main", "test-model", "low", "dirac", true);

		assert.ok(
			calls.some(
				(args) =>
					args[0] === "branch" &&
					args[1] === "--track" &&
					args[2] === `sandcastle/issue-${issue}`,
			),
			"the local branch is restored from origin so the chain base resolves",
		);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "add"),
			false,
			"restoring the branch must not create a worktree",
		);

		cleanupIssueArtifacts(issue);
	});
});

describe("immediate push-and-delete", () => {
	/** Records every git invocation the reclaim makes, in order. */
	function recordingGit(statusOutput = ""): Array<Array<string>> {
		const calls: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				calls.push([...args]);
				if (args[0] === "status") {
					return statusOutput;
				}

				return "";
			},
		});
		return calls;
	}

	/**
	 * The runner's own worktree path for a branch, created on disk. A real directory, so the
	 * removal path runs rather than short-circuiting on a missing path.
	 */
	function runnerWorktree(branch: string): string {
		const path = worktreePathForBranch(branch);
		mkdirSync(path, { recursive: true });
		return path;
	}

	test("pushes the branch before the worktree is removed", () => {
		/*
		 * The ordering is the whole point: the push is what makes the worktree disposable, so a
		 * removal that ran first would delete the only copy of the work it was protecting.
		 */
		const calls = recordingGit();
		const branch = "sandcastle/issue-42";
		const path = runnerWorktree(branch);

		reclaimMemberWorktree({ branch, issue: "42", worktreePath: path });

		const push = calls.findIndex((args) => args[0] === "push");
		const remove = calls.findIndex((args) => args[0] === "worktree" && args[1] === "remove");
		assert.notEqual(push, -1, "the branch was pushed");
		assert.notEqual(remove, -1, "the worktree was removed");
		assert.ok(push < remove, "push ran before the removal");

		rmSync(path, { force: true, recursive: true });
	});

	test("pushes a dirty member but keeps its worktree", () => {
		/*
		 * `dirtyPaths` reads `status --porcelain --untracked-files=no`; a review's uncommitted
		 * corrections live only in the worktree, so they have to survive the cleanup. The committed
		 * work still goes to origin — that is the durable half.
		 */
		const calls = recordingGit(" M src/a.ts\n");
		const branch = "sandcastle/issue-43";
		const path = runnerWorktree(branch);

		reclaimMemberWorktree({ branch, issue: "43", worktreePath: path });

		assert.equal(
			calls.some((args) => args[0] === "push"),
			true,
			"the committed work is pushed even when the worktree stays",
		);
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "remove"),
			false,
			"the worktree is kept",
		);
		assert.equal(existsSync(path), true, "and it is still on disk");

		rmSync(path, { force: true, recursive: true });
	});

	test("does nothing when the worktree is already gone", () => {
		const calls = recordingGit();

		reclaimMemberWorktree({
			branch: "sandcastle/issue-44",
			issue: "44",
			worktreePath: worktreePathForBranch("sandcastle/issue-44"),
		});

		assert.deepEqual(calls, [], "an absent worktree needs no push and no removal");
	});

	test("leaves a worktree the runner did not place alone", () => {
		/*
		 * `--worktree <path>` points at a worktree the caller made, so it is not this runner's to
		 * delete; `queue clean` refuses a foreign path for the same reason.
		 */
		const calls = recordingGit();
		const path = join(tmpRoot, "reclaim", "handmade");
		mkdirSync(path, { recursive: true });

		reclaimMemberWorktree({
			branch: "sandcastle/issue-45",
			issue: "45",
			worktreePath: path,
		});

		assert.deepEqual(calls, [], "a hand-made worktree is never pushed for or removed");
		assert.equal(existsSync(path), true, "and it is still there");

		rmSync(path, { force: true, recursive: true });
	});
});
