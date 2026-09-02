/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { main } from "./main.js";
import { ExitError, gitStub, registerTestHooks, stubExit, tmpRoot } from "./test-helpers.js";
import { worktreePathForBranch } from "./worktree.js";

registerTestHooks();

describe("main routing", () => {
	test("help and dry-run exit 0", async () => {
		const codes = stubExit();
		process.argv = ["node", "main.ts", "--help"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
		assert.deepEqual(codes, [0]);

		process.argv = ["node", "main.ts", "--issue", "1", "--dry-run", "--model", "m"];
		await assert.rejects(
			async () => main(),
			(err: unknown) => err instanceof ExitError && err.code === 0,
		);
	});

	test("missing issue number throws after help", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts"];
		await assert.rejects(async () => main(), /issue number/);
	});

	test("integration-status requires name", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts", "integration-status"];
		await assert.rejects(async () => main(), /--name is required/);
	});

	test("issue-sequence requires --sequential", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = "m";
		process.argv = ["node", "main.ts", "issue-sequence"];
		await assert.rejects(async () => main(), /--sequential is required/);
	});

	test("setup routes to runSetup and prepares a worktree", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = undefined;
		const worktree = join(tmpRoot, "setup-target");
		mkdirSync(worktree, { recursive: true });
		process.argv = ["node", "main.ts", "setup", "--worktree", worktree];
		// Default config: no setupCommands, no symlinks, no .env → completes cleanly.
		await assert.doesNotReject(async () => main());
	});

	test("setup --dry-run does not require a target directory", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = undefined;
		process.argv = ["node", "main.ts", "setup", "--dry-run"];
		await assert.doesNotReject(async () => main());
	});

	test("setup --branch creates a worktree via ensurePersistentWorktree", async () => {
		process.env.DIRAC_SANDCASTLE_MODEL = undefined;
		const branch = `sandcastle/setup-test-${Date.now()}`;
		const createdPaths: Array<string> = [];
		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${tmpRoot}\n`;
				}

				if (args[0] === "worktree" && args[1] === "add") {
					const path = args[4];
					if (path !== undefined) {
						mkdirSync(path, { recursive: true });
						createdPaths.push(path);
					}

					return "";
				}

				// show-ref / repair / resolution lookups → gitTry swallows these.
				return undefined;
			},
		});
		process.argv = ["node", "main.ts", "setup", "--branch", branch, "--base", "main"];
		try {
			await assert.doesNotReject(async () => main());
			assert.deepEqual(createdPaths, [worktreePathForBranch(branch)]);
		} finally {
			for (const path of createdPaths) {
				rmSync(path, { force: true, recursive: true });
			}
		}
	});
});
