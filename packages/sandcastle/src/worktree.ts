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
	unlinkSync,
} from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import {
	checkoutBranch,
	git,
	gitCommonDir,
	gitTry,
	registeredWorktrees,
	resolveCommit,
} from "./git.js";
import {
	config,
	integrationsDir,
	io,
	logsDir,
	normalizedPath,
	plansDir,
	repoRoot,
	stateDir,
	worktreePathForBranch,
	worktreesDir,
} from "./runtime.js";

export const sandboxProvider = noSandbox();

/** Runner state directories created under the configured state dir. */
export const setupDirectories: ReadonlyArray<string> = [
	worktreesDir,
	logsDir,
	plansDir,
	stateDir,
	integrationsDir,
];

/** Create the runner's state directories (worktrees, logs, plans, state, integrations). */
export function ensureSetupDirs(): void {
	for (const dir of setupDirectories) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * - Sweeps worktree registrations whose worktree directory is gone.
 * - @param options - `cwd` locates the repository that owns the registrations.
 * - @returns The registration ids that went away, sorted.
 * - @remarks Deleting a worktree directory by hand leaves its registration behind: git keeps listing
 *   the path until a prune notices the directory is missing, and `.git/worktrees` then accumulates
 *   entries nothing will ever claim again — the debris a batch of `rm -rf` leaves. `git worktree
 *   prune --expire now` is the sweep, and git is left to decide what is prunable rather than this
 *   reading each registration's pointer file itself: a **locked** worktree is deliberately
 *   protected (an external drive, say), and a hand-rolled sweep would delete exactly the
 *   registration git refuses to. The names are read before and after so the caller can report what
 *   went, since prune is silent.
 */
export function pruneWorktreeRegistrations(options: { cwd?: string } = {}): Array<string> {
	const cwd = options.cwd ?? repoRoot;
	const before = worktreeRegistrationNames(cwd);
	gitTry(["worktree", "prune", "--expire", "now"], cwd);
	const after = new Set(worktreeRegistrationNames(cwd));

	const swept = before.filter((name) => !after.has(name)).sort();
	if (swept.length > 0) {
		console.log(`  ✓ Pruned ${String(swept.length)} orphaned worktree registration(s).`);
	}

	return swept;
}

/** Registration directory names under the repository's `.git/worktrees`, or none when unreadable. */
function worktreeRegistrationNames(cwd: string): Array<string> {
	const common = gitCommonDir(cwd);
	if (common === undefined) {
		return [];
	}

	try {
		return readdirSync(pathResolve(common, "worktrees"));
	} catch {
		// No registrations at all.
		return [];
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
 * @remarks
 *   An entry whose name already exists in the target cannot be moved, and it exists nowhere else.
 *   The backup is therefore only deleted once it is empty: deleting it unconditionally destroyed
 *   every colliding entry without a word.
 * @returns How many entries were preserved, and the backup path when entries remain in it.
 */
function replaceDirectoryWithJunction(
	linkPath: string,
	targetPath: string,
): { backup?: string; preserved: number } {
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
				// Entry collides with an existing target file; it stays in the backup below.
			}
		}

		if (readdirSync(backup).length > 0) {
			return { backup, preserved };
		}

		rmSync(backup, { force: true, recursive: true });
		return { preserved };
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
				const replaced = replaceDirectoryWithJunction(linkPath, targetPath);
				console.log(
					`  ✓ Linked ${link.path} → ${targetPath} (preserved ${String(replaced.preserved)} pre-existing item(s))`,
				);
				if (replaced.backup !== undefined) {
					console.warn(
						`  ⚠ Entries that collided with ${targetPath} were kept at ${replaced.backup}; move them out yourself.`,
					);
				}

				continue;
			}

			symlinkSync(targetPath, linkPath, "junction");
			console.log(`  ✓ Linked ${link.path} → ${targetPath}`);
		} catch (err) {
			console.warn(`  ⚠ Could not link ${link.path}: ${String(err)}`);
		}
	}
}

/**
 * Removes every junction/symlink inside a worktree, leaving the link targets untouched and all real
 * content in place.
 *
 * `git worktree remove` recurses through directory junctions instead of unlinking them, so a linked
 * `dir` (e.g. `.sandcastle/plans` → the primary checkout's plans) has its **target's contents
 * deleted** and then fails with `failed to delete '…': Directory not empty`. Unlinking first is the
 * fix; leaving them for a recursive removal to walk is the data loss.
 *
 * The sweep covers the **whole tree**, not just the runner's own surface. A worktree also carries
 * links under `.workspace-links/**`, `.vscode/**`, and `node_modules/**` (pnpm's store links), and
 * any one of them pointing outside the worktree is enough to destroy content elsewhere — a
 * root-and-state-dir-only sweep found 3 of roughly 12,000 links in the field. Symlinks are never
 * followed, only unlinked, so vendored submodule links are removed as links and never traversed.
 *
 * @param worktreePath - Worktree about to be removed.
 * @returns The number of links unlinked.
 */
export function unlinkWorktreeLinks(worktreePath: string): number {
	const links: Array<string> = [];
	const pending: Array<string> = [worktreePath];

	while (pending.length > 0) {
		const dir = pending.pop()!;
		let names: Array<string> = [];
		try {
			names = readdirSync(dir);
		} catch {
			// Unreadable or already gone; nothing under it to unlink.
			continue;
		}

		for (const name of names) {
			// A worktree's `.git` is a pointer to the real git dir; its contents are not ours.
			if (name === ".git") {
				continue;
			}

			const path = pathResolve(dir, name);
			const stats = lstatSync(path, { throwIfNoEntry: false });
			if (stats === undefined) {
				continue;
			}

			if (stats.isSymbolicLink()) {
				links.push(path);
			} else if (stats.isDirectory()) {
				pending.push(path);
			}
		}
	}

	let unlinked = 0;
	for (const link of links) {
		try {
			// `unlinkSync` removes a junction itself; only `recursive` removal follows the target.
			unlinkSync(link);
			unlinked++;
		} catch (err) {
			console.warn(`  ⚠ Could not unlink ${link}: ${String(err)}`);
		}
	}

	if (unlinked > 0) {
		console.log(`  ✓ Unlinked ${String(unlinked)} worktree link(s) before removal.`);
	}

	return unlinked;
}

/**
 * Removes a worktree without following the links this runner placed inside it.
 *
 * @remarks
 *   Always unlinks first: git's own removal walks junctions and empties their targets, which
 *   destroyed the primary checkout's plans in the incident this guards against. The unlink step is
 *   best-effort — a failure there is logged and git still runs, since refusing to remove would leak
 *   the worktree forever and the links are what make removal dangerous, not the removal itself.
 * @param worktreePath - Worktree to remove.
 * @param options - `force` passes `--force` to git (dirty or mid-merge worktrees); `cwd` locates
 *   the repository that owns the worktree, defaulting to this checkout.
 */
export function removeWorktree(
	worktreePath: string,
	options: { cwd?: string; force?: boolean } = {},
): void {
	const cwd = options.cwd ?? repoRoot;
	if (removeWithRmdir(worktreePath)) {
		// The directory is gone; git only has to forget the registration it still holds.
		pruneWorktreeRegistrations({ cwd });
		return;
	}

	unlinkWorktreeLinks(worktreePath);
	git(["worktree", "remove", ...(options.force === true ? ["--force"] : []), worktreePath], cwd);
	pruneWorktreeRegistrations({ cwd });
}

/**
 * - Pushes a branch, then removes the worktree holding it.
 * - @param branch - Branch to push to `origin`.
 * - @param worktreePath - The branch's worktree.
 * - @remarks The order is the invariant, not an implementation detail: the push is what makes the
 *   worktree disposable, so a removal that ran first would delete the only copy of the work it was
 *   protecting. A failed push throws before anything is removed, which is what leaves the worktree
 *   in place for the caller to report. Both the immediate per-member reclaim and `queue clean
 *   --push-and-delete` go through here so neither can get the order wrong on its own.
 */
export function pushThenRemoveWorktree(branch: string, worktreePath: string): void {
	git(["push", "-u", "origin", branch]);
	removeWorktree(worktreePath, { force: true });
}

/**
 * - Deletes a directory with Windows' own `rmdir /s /q`.
 * - @param worktreePath - Directory to delete.
 * - @returns True when the directory is gone afterwards.
 * - @remarks `rmdir /s` deletes a directory junction or a file symlink itself and never recurses into
 *   its target — verified against both link kinds — so it needs no unlink sweep first and costs a
 *   fraction of walking a worktree's ~12,000 links. A path it cannot delete (read-only files, a
 *   path over the long-path limit) simply returns false and the caller falls back.
 */
function removeWithRmdir(worktreePath: string): boolean {
	if (process.platform !== "win32") {
		return false;
	}

	try {
		io.execFileSync("cmd", ["/c", "rmdir", "/s", "/q", worktreePath], {
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// rmdir is noisy about what it could not delete; the existence check below decides.
	}

	return !existsSync(worktreePath);
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
