/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { runSequentialIssues } from "./sequential.js";
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
			async () => runSequentialIssues([], "main", "m", "low", 1, "dirac", false),
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
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan");
		writeState(
			makeState(issue, {
				commits: ["c1"],
				design: "done",
				implement: "done",
				review: "done",
			}),
		);

		const codes = stubExit();
		gitStub({
			file: (args) => {
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

				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				return "";
			},
		});

		// Resume skip path for completed issue, then no blocked/failed.
		await runSequentialIssues([issue], "main", "test-model", "low", 1, "dirac", true);
		assert.deepEqual(codes, []);

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
			async () => runSequentialIssues([failingIssue], "main", "m", "low", 1, "dirac", false),
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

				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				return "";
			},
		});
		stubRun({
			commits: [{ sha: "c1" }],
			stdout: "ok",
		});

		await assert.rejects(
			async () =>
				runSequentialIssues([issue], "main", "model", "low", 5, "dirac", false, worktree),
			(err: unknown) => err instanceof ExitError && err.code === 1,
		);
		assert.equal(codes.at(-1), 1);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});
});
