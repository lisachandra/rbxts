/* oxlint-disable typescript/no-floating-promises -- node:test describe/test return Promises by design */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, test } from "node:test";

import { config, io, normalizedPath, sharedStateRoot, worktreePathForBranch } from "./runtime.js";
import { gitStub, registerTestHooks, tmpRoot } from "./test-helpers.js";
import {
	completeWorktreeRemoval,
	ensurePersistentWorktree,
	linkSymlinks,
	prepareIssueWorktree,
	pruneWorktreeRegistrations,
	removeWorktree,
	setupDirectories,
	setupLogPath,
	setupWorktree,
	unlinkWorktreeLinks,
} from "./worktree.js";

registerTestHooks();

const originalSetupCommands = config.setupCommands;
const originalSymlinks = config.symlinks;
const createdDirs: Array<string> = [];
/** Setup logs land in the real state dir, so tests remove the ones they touch. */
const createdLogs: Array<string> = [];

function makeDir(name: string): string {
	const dir = resolve(tmpRoot, "worktree", name);
	mkdirSync(dir, { recursive: true });
	createdDirs.push(dir);
	return dir;
}

/** Resolve a setup log path and register it (plus its rotated generation) for cleanup. */
function trackLog(worktree: string, kind: "issue" | "plain" | "integration" = "plain"): string {
	const logPath = setupLogPath(worktree, kind);
	createdLogs.push(logPath, `${logPath}.1`);
	return logPath;
}

afterEach(() => {
	config.setupCommands = originalSetupCommands;
	config.symlinks = originalSymlinks;
	for (const logPath of createdLogs.splice(0)) {
		rmSync(logPath, { force: true });
	}

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

	test("ignoreSetup returns the swallowed setup error as a single bounded line", () => {
		const worktree = makeDir("ignore-setup-note");
		config.setupCommands = ["failing-cmd"];
		config.symlinks = [];
		io.execSync = (() => {
			throw new Error("line one\nline two\nline three\nline four");
		}) as unknown as typeof io.execSync;

		const note = prepareIssueWorktree(worktree, true, false);
		assert.match(note ?? "", /line one \| line two \| line three/);
		assert.doesNotMatch(note ?? "", /line four/);
	});

	test("successful setup returns undefined", () => {
		const worktree = makeDir("setup-ok-note");
		config.setupCommands = ["setup-cmd"];
		config.symlinks = [];
		io.execSync = (() => "") as unknown as typeof io.execSync;

		assert.equal(prepareIssueWorktree(worktree, true, false), undefined);
	});

	test("skips the auto-rebase for paths that are not registered worktrees", () => {
		/*
		 * A plain directory (a test temp dir, a scratch path) resolves git commands to whatever
		 * repository contains it — here the rbxts checkout itself — and a rebase there would be a
		 * destructive surprise. Only registered worktrees qualify.
		 */
		const worktree = makeDir("not-a-worktree");
		config.setupCommands = ["setup-cmd"];
		config.symlinks = [];
		const gitCalls: Array<string> = [];
		io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
			if (command === "git") {
				gitCalls.push((Array.isArray(args) ? args : [args]).map(String).join(" "));
			}

			return "";
		}) as unknown as typeof io.execFileSync;
		io.execSync = (() => "") as unknown as typeof io.execSync;

		assert.equal(prepareIssueWorktree(worktree, true, false, "main"), undefined);
		// The registration check ran...
		assert.equal(
			gitCalls.some((call) => call.includes("worktree list")),
			true,
		);
		/*
		 * ...but no staleness probe or rebase followed. The setup command runs on a
		 * different io seam (execSync), so gitCalls holds nothing but the registration check.
		 */
		assert.equal(
			gitCalls.some((call) => call.includes("rev-list")),
			false,
		);
		assert.equal(
			gitCalls.some((call) => call.startsWith("rebase")),
			false,
		);
		assert.deepEqual(gitCalls, ["worktree list --porcelain"]);
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

	describe("setup output to a log file", () => {
		test("log mode redirects stdout/stderr to a file and reports the path", () => {
			const worktree = makeDir("log-mode");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];

			const captured: Array<{ command: string; stdio?: unknown }> = [];
			io.execSync = ((command: string, options?: { stdio?: unknown }) => {
				captured.push({ command: String(command), stdio: options?.stdio });
				return "";
			}) as unknown as typeof io.execSync;

			const lines: Array<string> = [];
			const note = setupWorktree(worktree, {
				emit: (line) => {
					lines.push(line);
				},
				output: "log",
			});

			assert.equal(note, undefined);
			assert.equal(captured.length, 1);
			const stdio = captured[0]?.stdio as Array<unknown>;
			assert.equal(stdio[0], "ignore");
			assert.equal(typeof stdio[1], "number");
			assert.equal(stdio[2], stdio[1]);

			const printed = lines.join("\n");
			assert.match(printed, /Running setup commands/);
			assert.match(printed, /setup-.*\.log/);

			const logFile = trackLog(worktree);
			assert.equal(existsSync(logFile), true);
			const log = readFileSync(logFile, "utf-8");
			assert.match(log, /--- Setup started: /);
			assert.match(log, /\$ setup-cmd/);
			assert.match(log, /cwd: /);
		});

		test("inherit mode leaves stdio untouched and logs nothing", () => {
			const worktree = makeDir("inherit-mode");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];

			const captured: Array<{ stdio?: unknown }> = [];
			io.execSync = ((_command: string, options?: { stdio?: unknown }) => {
				captured.push({ stdio: options?.stdio });
				return "";
			}) as unknown as typeof io.execSync;

			setupWorktree(worktree, { emit: () => {}, output: "inherit" });

			assert.equal(captured.length, 1);
			assert.equal(captured[0]?.stdio, "inherit");
			assert.equal(existsSync(trackLog(worktree)), false);
		});

		test("log names are namespaced per kind so issue and integration logs never collide", () => {
			const issue = setupLogPath(makeDir("same-name"), "issue");
			const integration = setupLogPath(makeDir("same-name"), "integration");

			assert.notEqual(issue, integration);
			assert.match(basename(issue), /^setup-issue-same-name\.log$/);
			assert.match(basename(integration), /^setup-integration-same-name\.log$/);
		});

		test("iteration appends a fresh header instead of truncating history", () => {
			const worktree = makeDir("log-append");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];
			io.execSync = (() => "") as unknown as typeof io.execSync;

			// Start clean: an earlier run of this suite may have left a log behind.
			const logFile = trackLog(worktree);
			rmSync(logFile, { force: true });

			setupWorktree(worktree, { emit: () => {}, output: "log" });
			setupWorktree(worktree, { emit: () => {}, output: "log" });

			const log = readFileSync(logFile, "utf-8");
			assert.equal(log.match(/--- Setup started: /g)?.length, 2);
		});

		test("a failed hidden setup rethrows with the log tail attached", () => {
			const worktree = makeDir("log-failure");
			config.setupCommands = ["failing-cmd"];
			config.symlinks = [];

			io.execSync = (() => {
				// Real children write their diagnostics to the inherited fd, not to `err`.
				const log = trackLog(worktree);
				writeFileSync(log, `${readFileSync(log, "utf-8")}boom: install failed\n`, {
					encoding: "utf-8",
				});
				throw new Error("Command failed: failing-cmd");
			}) as unknown as typeof io.execSync;

			assert.throws(
				() => setupWorktree(worktree, { emit: () => {}, output: "log" }),
				(err: Error) => {
					assert.match(err.message, /Command failed: failing-cmd/);
					assert.match(err.message, /boom: install failed/);
					assert.match(err.message, /Full output: /);
					return true;
				},
			);
		});

		test("ignoreSetup absorbs a hidden failure and cites the log in its note", () => {
			const worktree = makeDir("log-ignore");
			config.setupCommands = ["failing-cmd"];
			config.symlinks = [];
			io.execSync = (() => {
				throw new Error("setup exploded");
			}) as unknown as typeof io.execSync;

			const note = setupWorktree(worktree, {
				emit: () => {},
				ignoreSetup: true,
				output: "log",
			});

			assert.match(note ?? "", /setup exploded/);
			assert.match(note ?? "", /log: .*setup-.*\.log/);
		});

		test("a log that cannot be opened degrades to inherit instead of failing setup", () => {
			const worktree = makeDir("log-open-failure");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];

			const captured: Array<{ stdio?: unknown }> = [];
			io.execSync = ((_command: string, options?: { stdio?: unknown }) => {
				captured.push({ stdio: options?.stdio });
				return "";
			}) as unknown as typeof io.execSync;
			io.openSync = (() => {
				throw new Error("EACCES");
			}) as unknown as typeof io.openSync;

			try {
				assert.doesNotThrow(() =>
					setupWorktree(worktree, { emit: () => {}, output: "log" }),
				);
				assert.equal(captured[0]?.stdio, "inherit");
			} finally {
				io.openSync = ((...args: Parameters<typeof openSync>) =>
					openSync(...args)) as typeof io.openSync;
			}
		});

		test("the setup log rotates at the size cap, keeping one previous generation", () => {
			const worktree = makeDir("log-rotate");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];
			io.execSync = (() => "") as unknown as typeof io.execSync;

			const logFile = trackLog(worktree);
			mkdirSync(dirname(logFile), { recursive: true });
			writeFileSync(logFile, "x".repeat(6 * 1024 * 1024), "utf-8");

			setupWorktree(worktree, { emit: () => {}, output: "log" });

			assert.equal(existsSync(`${logFile}.1`), true);
			// The new generation starts clean: only this invocation's header is in it.
			assert.equal(readFileSync(logFile, "utf-8").match(/--- Setup started: /g)?.length, 1);
		});

		test("dry-run reports the resolved mode and would-be log path", () => {
			const worktree = makeDir("log-dry-run");
			config.setupCommands = ["setup-cmd"];
			config.symlinks = [];

			const output: Array<string> = [];
			const originalLog = console.log;
			console.log = (message?: unknown) => {
				output.push(String(message));
			};

			try {
				setupWorktree(worktree, { dryRun: true, output: "log" });
			} finally {
				console.log = originalLog;
			}

			const printed = output.join("\n");
			assert.match(printed, /"setupOutput": "log"/);
			assert.match(printed, /"logPath": "/);
			assert.equal(existsSync(trackLog(worktree)), false);
		});
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

		test("keeps the backup when a preserved entry collides with the target", () => {
			/*
			 * A colliding entry cannot be moved and exists nowhere else, so deleting the backup
			 * destroyed it without a word. The target's own entry wins, and the colliding one survives
			 * in a backup whose path the warning names.
			 *
			 * The collision is a file against a directory: renaming a file over an existing file
			 * succeeds (and overwrites it) on both platforms, so only a type mismatch actually fails.
			 */
			const worktree = makeDir("link-collide");
			const target = makeDir("link-target-collide");
			mkdirSync(join(target, "7.md"), { recursive: true });

			const plansPath = join(worktree, ".sandcastle", "plans");
			mkdirSync(plansPath, { recursive: true });
			writeFileSync(join(plansPath, "7.md"), "# worktree", "utf-8");

			config.symlinks = [{ path: ".sandcastle/plans", target }];
			linkSymlinks(worktree);

			if (process.platform === "win32") {
				assert.equal(
					lstatSync(plansPath).isSymbolicLink(),
					true,
					"the junction was created",
				);
				assert.equal(
					lstatSync(join(target, "7.md")).isDirectory(),
					true,
					"the target kept its own entry",
				);

				const backups = readdirSync(dirname(plansPath)).filter((entry) =>
					entry.startsWith("plans.backup"),
				);
				assert.equal(backups.length, 1, "the backup was kept rather than deleted");
				assert.equal(
					readFileSync(join(dirname(plansPath), backups[0] ?? "", "7.md"), "utf-8"),
					"# worktree",
					"the colliding entry survived",
				);
			}
		});
	});
});

describe("ensurePersistentWorktree reuse staleness", () => {
	test("reusing an existing branch warns when it lags the requested base", () => {
		const branch = `sandcastle/stale-reuse-${Date.now()}`;
		const path = worktreePathForBranch(branch);
		mkdirSync(path, { recursive: true });
		createdDirs.push(path);

		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${path}\nbranch refs/heads/${branch}\n`;
				}

				// rev-list --count HEAD..base → 12 commits behind; gitTry swallows the rest.
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "12";
				}

				return undefined;
			},
		});

		const warnings: Array<string> = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => {
			warnings.push(String(message));
		};

		try {
			assert.equal(ensurePersistentWorktree(branch, "main"), path);
		} finally {
			console.warn = originalWarn;
		}

		const staleness = warnings.find((line) => line.includes("commits behind main"));
		assert.match(staleness ?? "", /Reusing worktree .*sandcastle\/stale-reuse/);
		assert.match(staleness ?? "", /12 commits behind main/);
	});

	test("reusing a current branch stays silent", () => {
		const branch = `sandcastle/fresh-reuse-${Date.now()}`;
		const path = worktreePathForBranch(branch);
		mkdirSync(path, { recursive: true });
		createdDirs.push(path);

		gitStub({
			file: (args) => {
				if (args[0] === "worktree" && args[1] === "list") {
					return `worktree ${path}\nbranch refs/heads/${branch}\n`;
				}

				// rev-list --count → 0 behind.
				if (args[0] === "rev-list" && args[1] === "--count") {
					return "0";
				}

				return undefined;
			},
		});

		const warnings: Array<string> = [];
		const originalWarn = console.warn;
		console.warn = (message?: unknown) => {
			warnings.push(String(message));
		};

		try {
			assert.equal(ensurePersistentWorktree(branch, "main"), path);
		} finally {
			console.warn = originalWarn;
		}

		assert.equal(
			warnings.some((line) => line.includes("commits behind")),
			false,
		);
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

	test("removeWorktree fully removes a junction worktree on any git baseline", () => {
		/*
		 * The danger the unlink sweep exists for: a naive `git worktree remove`
		 * on a worktree containing a junction historically either refused the
		 * removal or recursed through the junction and emptied the linked
		 * target (the shared plans dir). git >= 2.56 exits 0 and leaves the
		 * target intact but keeps the junction and its empty parent dirs
		 * behind. The first probe records which baseline this git has; the
		 * second proves the production path is safe against all of them —
		 * links swept before git (or rmdir) runs, target intact, tree fully
		 * removed. A behavior change therefore flips the recorded baseline
		 * instead of failing the suite for everyone, while a production
		 * regression still fails here.
		 */
		const root = makeRepo("baseline");

		// Probe 1: what does raw git do with a junction in the tree?
		const naiveWorktree = addWorktree(root, "sandcastle/issue-2");
		const naiveTarget = resolve(root, "naive-target");
		mkdirSync(naiveTarget, { recursive: true });
		writeFileSync(join(naiveTarget, "keep.md"), "# keep", "utf-8");
		linkInto(naiveWorktree, ".sandcastle/plans", naiveTarget);

		let threw = false;
		try {
			execFileSync("git", ["worktree", "remove", "--force", naiveWorktree], {
				cwd: root,
				stdio: "pipe",
			});
		} catch {
			threw = true;
		}

		const emptied = !existsSync(join(naiveTarget, "keep.md"));
		const removed = !existsSync(naiveWorktree);
		const baseline = threw
			? "git refused the junction"
			: emptied
				? "git emptied the target"
				: removed
					? "git removed the worktree cleanly"
					: "git left the junction behind (target intact)";

		// Probe 2: the production path must preserve the target and remove the tree.
		const worktree = addWorktree(root, "sandcastle/issue-3");
		const protectedTarget = resolve(root, "protected-target");
		mkdirSync(protectedTarget, { recursive: true });
		writeFileSync(join(protectedTarget, "keep.md"), "# keep", "utf-8");
		linkInto(worktree, ".sandcastle/plans", protectedTarget);

		removeWorktree(worktree, { cwd: root, force: true });

		assert.equal(
			existsSync(join(protectedTarget, "keep.md")),
			true,
			`target survived under git baseline: ${baseline}`,
		);
		assert.equal(
			existsSync(worktree),
			false,
			`worktree fully removed under git baseline: ${baseline}`,
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

	test("pruneWorktreeRegistrations sweeps a hand-deleted worktree and keeps a live one", () => {
		const root = makeRepo("prune");
		const gone = addWorktree(root, "sandcastle/issue-6");
		const live = addWorktree(root, "sandcastle/issue-7");

		// What a manual `rm -rf` of a worktree leaves behind: no directory, registration intact.
		rmSync(gone, { force: true, recursive: true });
		assert.equal(
			existsSync(join(root, ".git", "worktrees", "sandcastle-issue-6")),
			true,
			"precondition: the registration outlives the directory",
		);

		const swept = pruneWorktreeRegistrations({ cwd: root });

		assert.ok(swept.includes("sandcastle-issue-6"), "the orphaned registration was swept");
		assert.equal(
			existsSync(join(root, ".git", "worktrees", "sandcastle-issue-6")),
			false,
			"its registration directory is gone",
		);
		assert.equal(
			existsSync(join(root, ".git", "worktrees", "sandcastle-issue-7")),
			true,
			"a worktree that still exists keeps its registration",
		);
		assert.equal(existsSync(live), true, "and its directory");
	});

	test("rmdir's output is not buffered, so a noisy delete cannot be killed mid-way", () => {
		/*
		 * `execFileSync` buffers a piped child against a 1 MiB `maxBuffer`. rmdir prints one line per
		 * path it cannot delete, and on a worktree with submodules that overflowed: the ENOBUFS kill
		 * arrived about two minutes in with the tree half-deleted, `.git` already gone, which then made
		 * `git worktree remove` refuse the path. `stdio: "ignore"` is what stops that.
		 */
		const root = makeRepo("rmdir-io");
		const worktree = addWorktree(root, "sandcastle/issue-8");
		config.symlinks = [];

		const calls: Array<{ args: ReadonlyArray<string>; options: unknown }> = [];
		const realExecFileSync = io.execFileSync;
		io.execFileSync = ((command: string, args: Array<string>, options: unknown) => {
			if (command === "cmd") {
				calls.push({ args, options });
				// Report failure without touching the tree, so the caller falls back.
				throw new Error("rmdir unavailable");
			}

			return realExecFileSync(command, args, options as never);
		}) as typeof io.execFileSync;

		try {
			removeWorktree(worktree, { cwd: root, force: true });
		} finally {
			io.execFileSync = realExecFileSync;
		}

		assert.equal(calls.length, 1, "rmdir ran once");
		const options = calls[0]?.options as undefined | { stdio?: unknown; timeout?: unknown };
		assert.deepEqual(
			options?.stdio,
			["ignore", "ignore", "ignore"],
			"a piped rmdir is buffered, and an over-buffer kill leaves a half-deleted tree",
		);
		assert.equal(typeof options?.timeout, "number", "an unbounded delete has a bound");
	});

	test("finishes a removal whose .git a partial delete already took", () => {
		/*
		 * What a killed rmdir leaves: the worktree marker gone, everything else still there.
		 * `git worktree remove` refuses that path outright, so the removal has to be completed
		 * directly — otherwise the worktree can never be removed and every retry repeats the work.
		 */
		const root = makeRepo("half-deleted");
		const worktree = addWorktree(root, "sandcastle/issue-9");
		rmSync(join(worktree, ".git"), { force: true });
		assert.equal(existsSync(join(worktree, ".git")), false, "precondition: the marker is gone");

		const calls: Array<Array<string>> = [];
		gitStub({
			file: (args) => {
				calls.push([...args]);
				return "";
			},
		});

		completeWorktreeRemoval(worktree, { cwd: root, force: true });

		assert.equal(existsSync(worktree), false, "the directory is gone");
		assert.equal(
			calls.some((args) => args[0] === "worktree" && args[1] === "remove"),
			false,
			"git is not asked to remove a path it cannot validate",
		);
	});

	test("sharedStateRoot sends a linked worktree to the checkout that owns the state", () => {
		/*
		 * The bug this guards: an agent whose cwd is a worktree mints state there, and the runner —
		 * which reads state from the checkout that owns the run — never sees it. A marker written by
		 * the agent is then invisible to the phase waiting on it.
		 */
		const root = makeRepo("state-root");
		const worktree = addWorktree(root, "sandcastle/issue-9");

		assert.equal(
			normalizedPath(sharedStateRoot(worktree)),
			normalizedPath(root),
			"a worktree resolves to the primary checkout",
		);
		assert.equal(
			normalizedPath(sharedStateRoot(root)),
			normalizedPath(root),
			"the primary checkout resolves to itself",
		);
	});
});
