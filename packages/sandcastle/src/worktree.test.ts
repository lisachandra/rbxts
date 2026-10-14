/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, test } from "node:test";

import { config, io } from "./runtime.js";
import { registerTestHooks, tmpRoot } from "./test-helpers.js";
import {
	linkSymlinks,
	prepareIssueWorktree,
	removeWorktree,
	setupDirectories,
	setupWorktree,
	unlinkWorktreeLinks,
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

/*
 * The incident these guard: `git worktree remove` walks directory junctions instead of unlinking
 * them, so removing a worktree emptied the *target* of a linked `.sandcastle/plans` — the primary
 * checkout's plans — and then failed with "Directory not empty". A stub cannot reproduce that: the
 * bug is git's own behaviour, so these tests build a real repository with real junctions.
 */
describe("junction-safe worktree removal", () => {
	/** A throwaway repo with an initial commit; `git worktree add` needs one. */
	function makeRepo(name: string): string {
		const root = resolve(tmpRoot, "junction-repo", name);
		rmSync(root, { force: true, recursive: true });
		mkdirSync(root, { recursive: true });
		createdDirs.push(root);
		const git = (args: ReadonlyArray<string>, cwd = root): void => {
			execFileSync("git", [...args], { cwd, stdio: "pipe" });
		};

		git(["init", "-q", "-b", "main"]);
		// The host may require a signature and carry no key; these commits are throwaway.
		git(["config", "commit.gpgsign", "false"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test"]);
		writeFileSync(join(root, "README.md"), "x", "utf-8");
		git(["add", "README.md"]);
		git(["commit", "-q", "-m", "init"]);
		return root;
	}

	function addWorktree(root: string, branch: string): string {
		const worktree = resolve(root, ".sandcastle", "worktrees", branch.replaceAll("/", "-"));
		execFileSync("git", ["worktree", "add", "-q", "-b", branch, worktree], {
			cwd: root,
			stdio: "pipe",
		});
		return worktree;
	}

	/** Creates a link the way `linkSymlinks` does: a junction into a real target. */
	function linkInto(worktree: string, relative: string, target: string): string {
		const linkPath = resolve(worktree, relative);
		mkdirSync(dirname(linkPath), { recursive: true });
		execFileSync(
			process.platform === "win32" ? "cmd" : "ln",
			process.platform === "win32"
				? ["/c", "mklink", "/J", linkPath, target]
				: ["-s", target, linkPath],
			{ stdio: "pipe" },
		);
		return linkPath;
	}

	test("removeWorktree keeps a linked plans dir's contents", () => {
		const root = makeRepo("plans");
		const worktree = addWorktree(root, "sandcastle/issue-1");
		const plansTarget = resolve(root, "primary-plans");
		mkdirSync(plansTarget, { recursive: true });
		writeFileSync(join(plansTarget, "341.md"), "# Plan 341", "utf-8");
		writeFileSync(join(plansTarget, "342.md"), "# Plan 342", "utf-8");

		config.symlinks = [{ path: ".sandcastle/plans", target: plansTarget }];
		const linkPath = linkInto(worktree, ".sandcastle/plans", plansTarget);
		assert.equal(lstatSync(linkPath).isSymbolicLink(), true, "precondition: link created");

		removeWorktree(worktree, { cwd: root, force: true });

		assert.equal(existsSync(join(plansTarget, "341.md")), true, "plan 341 survived");
		assert.equal(existsSync(join(plansTarget, "342.md")), true, "plan 342 survived");
	});

	test("git's own removal would have emptied the link target", () => {
		/*
		 * Pins the behaviour the fix exists for. When git stops recursing through junctions this
		 * fails, and the unlink sweep can be reconsidered rather than kept on faith.
		 */
		const root = makeRepo("baseline");
		const worktree = addWorktree(root, "sandcastle/issue-2");
		const target = resolve(root, "baseline-target");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "keep.md"), "# keep", "utf-8");
		linkInto(worktree, ".sandcastle/plans", target);

		let threw = false;
		try {
			execFileSync("git", ["worktree", "remove", "--force", worktree], {
				cwd: root,
				stdio: "pipe",
			});
		} catch {
			threw = true;
		}

		const emptied = !existsSync(join(target, "keep.md"));
		assert.equal(
			threw || emptied,
			true,
			"baseline: git either failed on the junction or emptied the target",
		);
	});

	test("unlinkWorktreeLinks removes only links, never real content", () => {
		const root = makeRepo("selective");
		const worktree = addWorktree(root, "sandcastle/issue-3");
		const target = resolve(root, "selective-target");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "inner.md"), "# inner", "utf-8");

		// A linked dir plus real content that must survive the sweep.
		config.symlinks = [{ path: "docs-link", target }];
		const linkPath = linkInto(worktree, "docs-link", target);
		writeFileSync(join(worktree, "real.ts"), "// real", "utf-8");
		mkdirSync(join(worktree, "src"), { recursive: true });
		writeFileSync(join(worktree, "src", "a.ts"), "// a", "utf-8");

		const unlinked = unlinkWorktreeLinks(worktree);

		assert.equal(unlinked, 1, "exactly the link was unlinked");
		assert.equal(existsSync(linkPath), false, "link is gone");
		assert.equal(existsSync(join(worktree, "real.ts")), true, "real file survived");
		assert.equal(existsSync(join(worktree, "src", "a.ts")), true, "nested real file survived");
		assert.equal(existsSync(join(target, "inner.md")), true, "link target survived");
	});

	test("unlinkWorktreeLinks sweeps a state-dir link that is no longer configured", () => {
		// Config drift: the link exists on disk but `config.symlinks` no longer lists it.
		const root = makeRepo("drift");
		const worktree = addWorktree(root, "sandcastle/issue-4");
		const target = resolve(root, "drift-target");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "plan.md"), "# plan", "utf-8");

		const linkPath = linkInto(worktree, join(config.dir, "plans"), target);
		config.symlinks = [];

		const unlinked = unlinkWorktreeLinks(worktree);

		assert.equal(unlinked, 1, "the drifted link was still found");
		assert.equal(existsSync(linkPath), false, "link is gone");
		assert.equal(existsSync(join(target, "plan.md")), true, "target survived");
	});

	test("unlinkWorktreeLinks sweeps links outside the runner's own surface", () => {
		/*
		 * The field shape: the runner's configured links sit at the worktree root and in `dir`, but a
		 * worktree also carries links under `.workspace-links/**`, `.vscode/**`, and
		 * `node_modules/**`. A root-and-state-dir-only sweep found 3 of roughly 12,000 links, and the
		 * ones it missed are what a recursive removal followed out of the worktree.
		 */
		const root = makeRepo("nested");
		const worktree = addWorktree(root, "sandcastle/issue-6");
		const target = resolve(root, "nested-target");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "keep.md"), "# keep", "utf-8");

		config.symlinks = [];
		linkInto(worktree, join("packages", "@internal", "pkg", "out"), target);
		linkInto(worktree, join("node_modules", "dep"), target);
		linkInto(worktree, join(".vscode", "mise-tools"), target);

		const unlinked = unlinkWorktreeLinks(worktree);

		assert.equal(unlinked, 3, "every nested link was found");
		assert.equal(existsSync(join(target, "keep.md")), true, "target survived the sweep");

		removeWorktree(worktree, { cwd: root, force: true });
		assert.equal(existsSync(join(target, "keep.md")), true, "target survived the removal");
		assert.equal(existsSync(worktree), false, "worktree removed");
	});

	test("removeWorktree tolerates a worktree with no links", () => {
		const root = makeRepo("plain");
		const worktree = addWorktree(root, "sandcastle/issue-5");
		config.symlinks = [];

		assert.doesNotThrow(() => removeWorktree(worktree, { cwd: root, force: true }));
		assert.equal(existsSync(worktree), false);
	});
});
