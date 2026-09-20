/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, test } from "node:test";

import { config, io } from "./runtime.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";
import {
	linkSymlinks,
	prepareIssueWorktree,
	setupDirectories,
	setupWorktree,
	worktreePathForBranch,
} from "./worktree.js";

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

	test("setupWorktree dry-run prints a summary without side effects", () => {
		const worktree = makeDir("dry-run");
		const target = makeDir("docs-target-dry");
		config.setupCommands = ["should-not-run"];
		config.symlinks = [{ path: "docs", target }];

		const output: Array<string> = [];
		const originalLog = console.log;
		console.log = (message?: unknown) => {
			output.push(String(message));
		};

		try {
			let ran = false;
			io.execSync = (() => {
				ran = true;
				return "";
			}) as unknown as typeof io.execSync;

			setupWorktree(worktree, { dryRun: true });

			assert.equal(ran, false);
			assert.equal(existsSync(join(worktree, "docs")), false);
			const printed = output.join("\n");
			assert.match(printed, /"worktree": "/);
			assert.match(printed, /"runSetupCommands": true/);
			assert.match(printed, /"setupCommands"/);
			assert.match(printed, /"should-not-run"/);
		} finally {
			console.log = originalLog;
		}
	});

	test("setupWorktree creates state dirs, runs setup, and links symlinks", () => {
		const worktree = makeDir("setup");
		const target = makeDir("docs-target-setup");
		config.setupCommands = ["setup-cmd"];
		config.symlinks = [{ path: "docs", target }];

		const calls: Array<{ command: string; cwd?: string }> = [];
		io.execSync = ((command: string, options?: { cwd?: string }) => {
			calls.push({ command: String(command), cwd: options?.cwd });
			return "";
		}) as unknown as typeof io.execSync;

		setupWorktree(worktree);

		assert.deepEqual(calls, [{ command: "setup-cmd", cwd: worktree }]);
		if (process.platform === "win32") {
			assert.equal(existsSync(join(worktree, "docs")), true);
		}

		for (const dir of setupDirectories) {
			assert.equal(existsSync(dir), true);
		}
	});

	test("worktreePathForBranch flattens branch names", () => {
		const path = worktreePathForBranch("sandcastle/issue-1");
		assert.equal(path.endsWith("sandcastle-issue-1"), true);
		assert.equal(basename(path), "sandcastle-issue-1");
	});

	describe("linkSymlinks with missing junction parent", () => {
		test("creates the parent dir and links a junction even when the parent is gitignored/absent", () => {
			const worktree = makeDir("link-missing-parent");
			const target = makeDir("link-target-parent");
			writeFileSync(join(target, "keep.txt"), "hi", "utf-8");

			/*
			 * Simulate the gitignored case: the link's parent (<worktree>/.sandcastle)
			 * does not exist on a fresh `git worktree add` checkout.
			 */
			config.symlinks = [{ path: ".sandcastle/plans", target }];
			linkSymlinks(worktree);

			if (process.platform === "win32") {
				assert.equal(existsSync(join(worktree, ".sandcastle", "plans")), true);
				assert.equal(
					lstatSync(join(worktree, ".sandcastle", "plans")).isSymbolicLink(),
					true,
				);
			}
		});

		test("preserves a pre-existing real plans dir into the junction and links it", () => {
			const worktree = makeDir("link-preserve");
			const target = makeDir("link-target-preserve");
			writeFileSync(join(target, "existing.txt"), "target", "utf-8");

			// A real plans dir already exists (e.g. written by a plan agent into `<wt>/.sandcastle/plans`).
			const plansPath = join(worktree, ".sandcastle", "plans");
			mkdirSync(plansPath, { recursive: true });
			writeFileSync(join(plansPath, "7.md"), "# Plan 7", "utf-8");

			config.symlinks = [{ path: ".sandcastle/plans", target }];
			linkSymlinks(worktree);

			if (process.platform === "win32") {
				assert.equal(lstatSync(plansPath).isSymbolicLink(), true);
				// The agent-written plan made it into the junction target.
				assert.equal(existsSync(join(target, "7.md")), true);
				// No leftover backup dir remains next to the link.
				assert.equal(
					readdirSync(dirname(plansPath)).some((entry) =>
						entry.startsWith("plans.backup"),
					),
					false,
				);
			}
		});
	});
});
