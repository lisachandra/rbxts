import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { describe, test } from "vitest";

import { worktreePathForBranch } from "./runtime.js";
import { writeState } from "./state.js";
import { printStatus } from "./status.js";
import {
	cleanupIssueArtifacts,
	gitStub,
	makeState,
	registerTestHooks,
	uniqueIssue,
} from "./test-helpers.js";

registerTestHooks();

/** Captures sequentially the lines printed by `run`. */
function captureOutput(run: () => void): Array<string> {
	const lines: Array<string> = [];
	const original = console.log;
	console.log = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		run();
	} finally {
		console.log = original;
	}

	return lines;
}

describe("printStatus", () => {
	test("prints the issue title resolved through issueMetadata", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
			sync: (command) => {
				if (command.includes("gh issue view")) {
					return JSON.stringify({ labels: [{ name: "ecs" }], title: "Title A" });
				}

				return undefined;
			},
		});

		const lines = captureOutput(() => printStatus("42", "model-x", "main"));

		assert.ok(
			lines.some((line) => line.includes("Issue #42: Title A")),
			`expected issue header line, got: ${JSON.stringify(lines)}`,
		);
	});

	test("falls back to a placeholder title when gh fails", () => {
		gitStub({
			file: (args) => {
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
			sync: () => {
				throw new Error("gh down");
			},
		});

		const lines = captureOutput(() => printStatus("7", "model-x", "main"));

		assert.ok(
			lines.some((line) => line.includes("Issue #7: (could not fetch)")),
			`expected fallback issue header line, got: ${JSON.stringify(lines)}`,
		);
	});

	test("looks for the worktree at the runner's own path", () => {
		/*
		 * `printStatus` hand-built the path from `repoRoot` while every other caller used the shared
		 * helper, so a run from inside a linked worktree reported a worktree that exists as missing.
		 */
		gitStub({
			file: (args) => {
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
			sync: (command) =>
				command.includes("gh issue view")
					? JSON.stringify({ labels: [], title: "Title C" })
					: undefined,
		});

		const branch = "sandcastle/issue-88";
		const worktree = worktreePathForBranch(branch);
		mkdirSync(worktree, { recursive: true });

		try {
			const lines = captureOutput(() => printStatus("88", "model-x", "main"));
			assert.ok(
				lines.some((line) => line === "Worktree: exists"),
				`expected the worktree to be found, got: ${JSON.stringify(lines)}`,
			);
		} finally {
			rmSync(worktree, { force: true, recursive: true });
		}
	});

	test("names the selection a phase actually ran on when the config has moved since", () => {
		/*
		 * The point of stamping `phasesConfig`: after a live reload the config says one thing and the
		 * finished phase ran another. Printing only the config would make the run look like it always
		 * ran the new model.
		 */
		const issue = uniqueIssue();
		gitStub({
			file: (args) => (args[0] === "rev-list" && args[1] === "--count" ? "2" : undefined),
			sync: (command) =>
				command.includes("gh issue view")
					? JSON.stringify({ labels: [], title: "Title D" })
					: undefined,
		});

		const state = makeState(issue, { implement: "done" });
		writeState({
			...state,
			phasesConfig: {
				design: { agentBackend: "zcode", effort: "low", model: "old-design" },
				implement: { agentBackend: "zcode", effort: "low", model: "old-implement" },
			},
		} as never);

		try {
			const lines = captureOutput(() =>
				printStatus(
					issue,
					{ design: "new-design", implement: "new-implement", review: "new-review" },
					"main",
					undefined,
					{
						design: { agentBackend: "zcode", effort: "high", model: "new-design" },
						implement: {
							agentBackend: "zcode",
							effort: "high",
							model: "new-implement",
						},
						integrationReview: { agentBackend: "zcode", effort: "high", model: "x" },
						planner: { agentBackend: "zcode", effort: "high", model: "x" },
						resolve: { agentBackend: "zcode", effort: "high", model: "x" },
						review: { agentBackend: "zcode", effort: "high", model: "new-review" },
					},
				),
			);

			const implement = lines.find((line) => line.trimStart().startsWith("implement:"));
			assert.ok(
				implement?.includes("last run used zcode/old-implement (low)"),
				`expected the previous selection on the implement line, got: ${String(implement)}`,
			);
			/* Review never ran, so there is nothing to compare it against. */
			const review = lines.find((line) => line.trimStart().startsWith("review:"));
			assert.equal(review?.includes("last run used"), false, String(review));
		} finally {
			cleanupIssueArtifacts(issue);
		}
	});
});
