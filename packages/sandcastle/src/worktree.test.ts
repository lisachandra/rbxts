/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, test } from "node:test";

import { config, io } from "./runtime.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";
import { prepareIssueWorktree } from "./worktree.js";

registerTestHooks();

const originalSetupCommands = config.setupCommands;
const originalSymlinks = config.symlinks;
const createdDirs: Array<string> = [];

function makeDir(name: string): string {
	const dir = resolve(tmpRoot, "worktree", name);
	mkdirSync(dir, { recursive: true });
	createdDirs.push(dir);
	return dir;
}

afterEach(() => {
	config.setupCommands = originalSetupCommands;
	config.symlinks = originalSymlinks;
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

describe("prepareIssueWorktree", () => {
	test("runs setup commands and links symlinks by default", () => {
		const worktree = makeDir("default");
		const target = makeDir("docs-target");
		config.setupCommands = ["setup-cmd"];
		config.symlinks = [{ path: "docs", target }];

		const calls: Array<{ command: string; cwd?: string }> = [];
		io.execSync = ((command: string, options?: { cwd?: string }) => {
			calls.push({ command: String(command), cwd: options?.cwd });
			return "";
		}) as unknown as typeof io.execSync;

		prepareIssueWorktree(worktree);

		assert.deepEqual(calls, [{ command: "setup-cmd", cwd: worktree }]);
		if (process.platform === "win32") {
			assert.equal(existsSync(join(worktree, "docs")), true);
		}
	});

	test("still links symlinks when setup fails with ignoreSetup", () => {
		const worktree = makeDir("ignore-setup");
		const target = makeDir("docs-target-ignore");
		config.setupCommands = ["failing-cmd"];
		config.symlinks = [{ path: "docs", target }];
		io.execSync = (() => {
			throw new Error("setup exploded");
		}) as unknown as typeof io.execSync;

		assert.doesNotThrow(() => prepareIssueWorktree(worktree, true, false));
		if (process.platform === "win32") {
			assert.equal(existsSync(join(worktree, "docs")), true);
		}
	});

	test("throws when setup fails without ignoreSetup", () => {
		const worktree = makeDir("throw");
		const target = makeDir("docs-target-throw");
		config.setupCommands = ["failing-cmd"];
		config.symlinks = [{ path: "docs", target }];
		io.execSync = (() => {
			throw new Error("setup exploded");
		}) as unknown as typeof io.execSync;

		assert.throws(() => prepareIssueWorktree(worktree, false, false), /setup exploded/);
		assert.equal(existsSync(join(worktree, "docs")), false);
	});

	test("skipSetup skips commands but still links symlinks", () => {
		const worktree = makeDir("skip-setup");
		const target = makeDir("docs-target-skip");
		config.setupCommands = ["should-not-run"];
		config.symlinks = [{ path: "docs", target }];

		let ran = false;
		io.execSync = (() => {
			ran = true;
			return "";
		}) as unknown as typeof io.execSync;

		prepareIssueWorktree(worktree, true, true);

		assert.equal(ran, false);
		if (process.platform === "win32") {
			assert.equal(existsSync(join(worktree, "docs")), true);
		}
	});
});
