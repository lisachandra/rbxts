/*
 * Worktree lifecycle for the persistent issue sandbox: create/reuse registered
 * worktrees, link repository-local directories into them, and run the repo's
 * setup commands once per fresh worktree.
 */

import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { checkoutBranch, git, gitTry, registeredWorktrees, resolveCommit } from "./git.js";
import {
	config,
	integrationsDir,
	io,
	logsDir,
	normalizedPath,
	plansDir,
	repoRoot,
	stateDir,
} from "./runtime.js";

export const sandboxProvider = noSandbox();

const worktreesDir = pathResolve(repoRoot, config.dir, "worktrees");

/** Runner state directories created under the configured state dir. */
export const setupDirectories: ReadonlyArray<string> = [
	worktreesDir,
	logsDir,
	plansDir,
	stateDir,
	integrationsDir,
];

/** Deterministic worktree path for a branch under the configured state dir. */
export function worktreePathForBranch(branch: string): string {
	return pathResolve(worktreesDir, branch.replace(/\//g, "-"));
}

/** Create the runner's state directories (worktrees, logs, plans, state, integrations). */
export function ensureSetupDirs(): void {
	for (const dir of setupDirectories) {
		mkdirSync(dir, { recursive: true });
	}
}

export interface PersistentSandbox {
	close(): Promise<void>;
	run(options: SandboxRunOptions): Promise<SandboxRunResult>;
	readonly worktreePath: string;
}

/** Create or reuse a worktree without invoking Sandcastle's prune lifecycle. */
export function ensurePersistentWorktree(branch: string, baseRef = "HEAD"): string {
	const worktreePath = worktreePathForBranch(branch);
	mkdirSync(worktreesDir, { recursive: true });

	const registered = registeredWorktrees();
	const matchingPath = registered.find(
		(worktree) => normalizedPath(worktree.path) === normalizedPath(worktreePath),
	);
	if (matchingPath) {
		if (matchingPath.branch !== branch) {
			throw new Error(
				`Worktree path ${worktreePath} belongs to branch ${matchingPath.branch ?? "(detached)"}; refusing to prune or replace it.`,
			);
		}

		return worktreePath;
	}

	const matchingBranch = registered.find((worktree) => worktree.branch === branch);
	if (matchingBranch) {
		throw new Error(
			`Branch ${branch} is already checked out at ${matchingBranch.path}; refusing to prune or replace that worktree.`,
		);
	}

	const existingBranch = checkoutBranch(worktreePath);
	if (existingBranch !== undefined && existingBranch !== "") {
		if (existingBranch !== branch) {
			throw new Error(
				`Worktree path ${worktreePath} contains branch ${existingBranch}; refusing to reuse it for ${branch}.`,
			);
		}

		git(["worktree", "repair", worktreePath]);
		return worktreePath;
	}

	if (existsSync(worktreePath) || lstatSync(worktreePath, { throwIfNoEntry: false })) {
		throw new Error(
			`Unregistered worktree path ${worktreePath} exists but is not a valid Git checkout; refusing to replace it.`,
		);
	}

	if (gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) !== undefined) {
		git(["worktree", "add", worktreePath, branch]);
	} else {
		git(["worktree", "add", "-b", branch, worktreePath, baseRef]);
	}

	return worktreePath;
}

/**
 * Replace a real directory occupying `linkPath` with a junction to `targetPath`, preserving its
 * contents into the target. Repairs drift left by an earlier phase whose junction failed to link
 * (e.g. gitignored `.sandcastle/plans`), while keeping plan files an agent already wrote.
 *
 * @returns The number of entries preserved into the target.
 */
function replaceDirectoryWithJunction(linkPath: string, targetPath: string): number {
	const backup = `${linkPath}.backup-${Date.now()}`;
	renameSync(linkPath, backup);
	try {
		symlinkSync(targetPath, linkPath, "junction");
		let preserved = 0;
		for (const entry of readdirSync(backup)) {
			if (entry.startsWith(".")) {
				continue;
			}

			try {
				renameSync(pathResolve(backup, entry), pathResolve(targetPath, entry));
				preserved++;
			} catch {
				// Entry collides with an existing target file; leave it in the backup dir.
			}
		}

		rmSync(backup, { force: true, recursive: true });
		return preserved;
	} catch (err) {
		// Restore the original directory so nothing is lost, then surface the failure.
		renameSync(backup, linkPath);
		throw err;
	}
}

/** Link repository-local directories (docs, agent rules, assets) into a sandbox worktree. */
export function linkSymlinks(worktreePath: string): void {
	for (const link of config.symlinks) {
		const linkPath = pathResolve(worktreePath, link.path);
		const targetPath = pathResolve(repoRoot, link.target);

		if (!existsSync(targetPath)) {
			console.warn(`  ⚠ ${link.target} not found at ${targetPath}; skipping symlink.`);
			continue;
		}

		try {
			/*
			 * Junctions (Windows) require their parent directory to exist. Repo-local dirs
			 * that are gitignored (e.g. `.sandcastle/`) are absent from fresh `git worktree
			 * add` checkouts, so create the parent here instead of letting symlinkSync fail
			 * with ENOENT.
			 */
			mkdirSync(dirname(linkPath), { recursive: true });

			if (lstatSync(linkPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
				continue;
			}

			if (existsSync(linkPath)) {
				if (!lstatSync(linkPath).isDirectory()) {
					console.warn(`  ⚠ ${link.path} exists as a file; skipping symlink.`);
					continue;
				}

				// A real dir minted by an earlier phase occupies the link path; preserve it into the junction.
				const preserved = replaceDirectoryWithJunction(linkPath, targetPath);
				console.log(
					`  ✓ Linked ${link.path} → ${targetPath} (preserved ${preserved} pre-existing item(s))`,
				);
				continue;
			}

			symlinkSync(targetPath, linkPath, "junction");
			console.log(`  ✓ Linked ${link.path} → ${targetPath}`);
		} catch (err) {
			console.warn(`  ⚠ Could not link ${link.path}: ${String(err)}`);
		}
	}
}

async function createPersistentSandbox(
	branch: string,
	baseRef = "HEAD",
): Promise<PersistentSandbox> {
	const worktreePath = ensurePersistentWorktree(branch, baseRef);
	return {
		// The worktree intentionally survives every run; only the agent process ends.
		close: async () => undefined,
		run: async (options) =>
			io.run({
				...options,
				branchStrategy: { type: "head" },
				cwd: worktreePath,
				sandbox: sandboxProvider,
			}),
		worktreePath,
	};
}

export async function createIssueSandbox(
	branchName: string,
	suppliedWorktree: undefined | { branch: string; path: string },
	baseRef: string | undefined,
): Promise<PersistentSandbox> {
	if (suppliedWorktree !== undefined) {
		return {
			close: async () => undefined,
			run: async (runOptions: SandboxRunOptions) =>
				io.run({
					...runOptions,
					branchStrategy: { type: "head" },
					cwd: suppliedWorktree.path,
					sandbox: sandboxProvider,
				}),
			worktreePath: suppliedWorktree.path,
		};
	}

	return createPersistentSandbox(branchName, baseRef);
}

export function validateExistingWorktree(worktreePath: string): {
	branch: string;
	commit: string;
	path: string;
} {
	const path = pathResolve(worktreePath);
	if (!existsSync(path) || !lstatSync(path).isDirectory()) {
		throw new Error(`Worktree does not exist: ${path}`);
	}

	if (normalizedPath(path) === normalizedPath(repoRoot)) {
		throw new Error("--worktree cannot target the repository root.");
	}

	const registered = registeredWorktrees().find(
		(worktree) => normalizedPath(worktree.path) === normalizedPath(path),
	);
	if (!registered) {
		throw new Error(`Path is not a registered Git worktree: ${path}`);
	}

	const branch = registered.branch ?? checkoutBranch(path);
	if (branch === undefined || branch === "") {
		throw new Error(`Worktree is detached: ${path}`);
	}

	const commit = resolveCommit("HEAD", path);
	if (git(["status", "--porcelain"], path).length > 0) {
		throw new Error(`Worktree is dirty; refusing to append: ${path}`);
	}

	return { branch, commit, path };
}

export interface SetupWorktreeOptions {
	dryRun?: boolean;
	ignoreSetup?: boolean;
	skipSetup?: boolean;
}

/**
 * Prepares a worktree for agent runs without starting one: creates the runner's state directories,
 * copies the repo `.env` when present, runs the configured `setupCommands`, and links configured
 * `symlinks`. Idempotent — safe to re-run on worktrees that already went through an issue or
 * integration run.
 *
 * `dryRun` prints a JSON summary of what would happen without executing anything. `skipSetup` skips
 * the setup commands but still copies `.env` and links symlinks; `ignoreSetup` continues (with a
 * warning) when the setup commands fail.
 */
export function setupWorktree(worktreePath: string, options: SetupWorktreeOptions = {}): void {
	ensureSetupDirs();
	const { dryRun = false, ignoreSetup = false, skipSetup = false } = options;

	const envSource = pathResolve(repoRoot, ".env");
	const setupCommand = config.setupCommands.join(" && ");

	if (dryRun) {
		console.log(
			JSON.stringify(
				{
					dirs: setupDirectories,
					env: existsSync(envSource) ? "copy" : "skip-missing",
					runSetupCommands: !skipSetup && setupCommand !== "",
					setupCommands: config.setupCommands,
					symlinks: config.symlinks.map((link) => ({
						path: link.path,
						status: existsSync(pathResolve(repoRoot, link.target))
							? "link"
							: "warn-missing-target",
						target: link.target,
					})),
					worktree: worktreePath,
				},
				undefined,
				2,
			),
		);
		return;
	}

	console.log("\n── Setup ──");

	if (existsSync(envSource)) {
		copyFileSync(envSource, pathResolve(worktreePath, ".env"));
		console.log(`  ✓ Copied .env → ${pathResolve(worktreePath, ".env")}`);
	}

	if (skipSetup) {
		console.log("  ⏭ Skipping setup commands.");
	} else if (setupCommand !== "") {
		try {
			io.execSync(setupCommand, { cwd: worktreePath, stdio: "inherit" });
		} catch (err) {
			if (!ignoreSetup) {
				throw err;
			}

			console.warn(`  ⚠ Setup failed (continuing): ${String(err)}`);
		}
	}

	/*
	 * Symlinks are independent of the setup commands: always link them so agent docs/rules
	 * are available even when setup was skipped or failed and ignored.
	 */
	linkSymlinks(worktreePath);
	console.log("  ✓ Setup complete.");
}

export function prepareIssueWorktree(
	worktreePath: string,
	ignoreSetup = false,
	skipSetup = false,
): void {
	setupWorktree(worktreePath, { ignoreSetup, skipSetup });
}
