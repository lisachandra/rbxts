/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { describe, test } from "node:test";

import { worktreePathForBranch } from "./runtime.js";
import { printStatus } from "./status.js";
import { gitStub, registerTestHooks } from "./test-helpers.js";

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
});
