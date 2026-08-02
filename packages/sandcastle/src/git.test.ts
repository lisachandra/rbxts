/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { checkoutBranch, commitExists, countNewCommits, registeredWorktrees, resolveCommit } from "./git.js";
import { io } from "./runtime.js";
import { gitStub, registerTestHooks, stubExecSync, tmpRoot } from "./test-helpers.js";

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
		io.execSync = () => {
			throw new Error("bad");
		};

		assert.equal(countNewCommits(tmpRoot, "main"), 0);

		stubExecSync("4");
		assert.equal(countNewCommits(tmpRoot, "main"), 4);
	});
});
