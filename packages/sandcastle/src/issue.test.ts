/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { runAll, runSingleIssue } from "./issue.js";
import { readState, writeState } from "./state.js";
import {
	cleanupIssueArtifacts,
	gitStub,
	makeState,
	registerTestHooks,
	stubRun,
	tmpRoot,
	uniqueIssue,
	writePlan,
} from "./test-helpers.js";

registerTestHooks();

describe("orchestration with heavy stubs", () => {
	test("runSingleIssue fresh run completes design/implement/review with supplied worktree", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-single-${issue}`);
		mkdirSync(worktree, { recursive: true });
		writePlan(issue, "# Plan\n");

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
				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [{ name: "ecs" }] });
				}

				if (command.includes("gh issue view")) {
					return "Test issue title";
				}

				if (command.includes("rev-list")) {
					return "1";
				}

				if (command.includes("fetch-places") || command.includes("pnpm setup")) {
					return "";
				}

				return "";
			},
		});

		stubRun({
			commits: [{ sha: "c1" }],
			stdout: "agent output",
		});

		await runSingleIssue(issue, "model", "low", 5, {
			agentBackend: "dirac",
			baseRef: "main",
			worktree,
		});

		const state = readState(issue);
		assert.equal(state?.phases.design.status, "done");
		assert.equal(state?.phases.implement.status, "done");
		assert.equal(state?.phases.review.status, "done");

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSingleIssue records design failure on empty stdout", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-empty-${issue}`);
		mkdirSync(worktree, { recursive: true });

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
				if (command.includes("gh issue view") && command.includes("labels")) {
					return JSON.stringify({ labels: [] });
				}

				if (command.includes("gh issue view")) {
					return "title";
				}

				if (command.includes("rev-list")) {
					return "0";
				}

				return "";
			},
		});
		stubRun({ commits: [], stdout: "" });

		await runSingleIssue(issue, "model", "low", 5, {
			agentBackend: "dirac",
			worktree,
		});
		assert.equal(readState(issue)?.phases.design.status, "failed");

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runSingleIssue resume with all skip does not run setup", async () => {
		const issue = uniqueIssue();
		const worktree = join(tmpRoot, `run-skip-${issue}`);
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

		let setupCalls = 0;
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
				if (command.includes("fetch-places") || command.includes("pnpm setup")) {
					setupCalls += 1;
					return "";
				}

				if (command.includes("rev-list")) {
					return "2";
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

		await runSingleIssue(issue, "test-model", "low", 5, {
			agentBackend: "dirac",
			resume: true,
			worktree,
		});
		assert.equal(setupCalls, 0);

		cleanupIssueArtifacts(issue);
		rmSync(worktree, { force: true, recursive: true });
	});

	test("runAll handles empty plan and concurrent failures", async () => {
		stubRun({
			output: { issues: [] },
		});
		await runAll("m", "dirac", "low", 5, 1);

		stubRun({
			output: {
				issues: [
					{ branch: "b1", id: uniqueIssue("8"), title: "one" },
					{ branch: "b2", id: uniqueIssue("8"), title: "two" },
				],
			},
		});

		const originalRunSingle = runSingleIssue;
		// Force failures by making validate worktree fail through missing git stubs.
		gitStub({
			file: () => {
				throw new Error("no git");
			},
			sync: () => {
				throw new Error("no sync");
			},
		});
		await runAll("m", "dirac", "low", 5, 2);
		void originalRunSingle;
	});
});
