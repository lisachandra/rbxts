/*
 * Worktree lifecycle for the persistent issue sandbox: create/reuse registered
 * worktrees, link repository-local directories into them, and run the repo's
 * setup commands once per fresh worktree.
 */

import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import {
	appendFileSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, resolve as pathResolve, relative } from "node:path";

import type { SetupOutput } from "./config.js";
import {
	checkoutBranch,
	countStaleCommits,
	git,
	gitCommonDir,
	gitTry,
	registeredWorktrees,
	resolveCommit,
} from "./git.js";
import { formatRunStarted } from "./logging.js";
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

/**
 * How long the Windows directory delete may run before it is treated as failed.
 *
 * Generous, because deleting a worktree with submodules legitimately takes minutes — but bounded,
 * so a delete that is never going to finish falls back to the unlink sweep instead of running
 * forever with no output.
 */
const rmdirTimeoutMs = 15 * 60 * 1000;

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

		reportReusedWorktreeStaleness(worktreePath, branch, baseRef);
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
		reportReusedWorktreeStaleness(worktreePath, branch, baseRef);
		return worktreePath;
	}

	if (existsSync(worktreePath) || lstatSync(worktreePath, { throwIfNoEntry: false })) {
		throw new Error(
			`Unregistered worktree path ${worktreePath} exists but is not a valid Git checkout; refusing to replace it.`,
		);
	}

	if (gitTry(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) !== undefined) {
		/*
		 * The branch exists, so it is checked out as-is and `baseRef` is silently not used — a stale
		 * branch cut days ago reads exactly like a fresh one. Say which base the caller asked for
		 * and how far the branch lags it, so a reused stale member (the #200 batch) is visible
		 * instead of only surfacing later as a failed install.
		 */
		git(["worktree", "add", worktreePath, branch]);
		reportReusedWorktreeStaleness(worktreePath, branch, baseRef);
	} else {
		git(["worktree", "add", "-b", branch, worktreePath, baseRef]);
	}

	return worktreePath;
}

/**
 * - Warn when a reused worktree's branch lags the base the caller asked for.
 * - @param worktreePath - The worktree about to be reused.
 * - @param branch - The branch checked out in it.
 * - @param baseRef - The base the run would have used for a fresh cut.
 * - @remarks `ensurePersistentWorktree` reuses an existing branch as-is and drops `baseRef` on the
 *   floor, so the caller's base only takes effect for brand-new branches. The staleness itself is
 *   reported (not repaired) here — repair is the setup-phase rebase's job, which runs with the
 *   dirty-tree and registration guards.
 */
function reportReusedWorktreeStaleness(
	worktreePath: string,
	branch: string,
	baseRef: string,
): void {
	const staleCommits = countStaleCommits(worktreePath, baseRef);
	if (staleCommits > 0) {
		console.warn(
			`  ℹ Reusing worktree ${worktreePath} at ${branch} — ${String(staleCommits)} commits behind ${baseRef}.`,
		);
	}
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

	/*
	 * The slow path, and it is slow: this walks every link in the tree before git runs, which on a
	 * worktree with submodules takes minutes. Say so, because the alternative is an operator watching
	 * a silent command and concluding it has hung.
	 */
	console.log(`  ⏳ ${worktreePath}: unlinking links before removal (this can take minutes).`);
	unlinkWorktreeLinks(worktreePath);
	completeWorktreeRemoval(worktreePath, options);
}

/**
 * - Finishes a removal whose directory is still on disk.
 * - @param worktreePath - Worktree to finish removing.
 * - @param options - `force` passes `--force` to git; `cwd` locates the owning repository.
 * - @remarks A partial delete can take the worktree's `.git` file with it and leave everything else —
 *   exactly what a killed `rmdir` leaves behind. `git worktree remove` then refuses the path
 *   outright ("cannot remove working tree: '<path>/.git' does not exist"), so the removal can never
 *   complete and every retry repeats the same work. With the marker gone the directory is no longer
 *   a worktree as far as git is concerned, so it is deleted directly and the prune forgets the
 *   registration. Exported only so the missing-`.git` branch can be pinned by a test;
 *   `removeWorktree` is the sole production caller.
 *
 * @internal
 */
export function completeWorktreeRemoval(
	worktreePath: string,
	options: { cwd?: string; force?: boolean } = {},
): void {
	const cwd = options.cwd ?? repoRoot;
	if (existsSync(pathResolve(worktreePath, ".git"))) {
		git(
			["worktree", "remove", ...(options.force === true ? ["--force"] : []), worktreePath],
			cwd,
		);
	} else {
		rmSync(worktreePath, { force: true, recursive: true });
	}

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
 *
 *   `stdio: "ignore"` is load-bearing rather than tidiness. rmdir prints one line per path it cannot
 *   delete, and `execFileSync` buffers a piped child against a 1 MiB `maxBuffer`: on a worktree with
 *   submodules that overflowed and the `ENOBUFS` kill arrived about two minutes in, with the tree
 *   half-deleted — `.git` gone, the rest still there — which then made `git worktree remove` refuse
 *   the path and left the worktree unremovable. Nothing here reads that output; the existence check
 *   below decides, and the timeout turns an unbounded delete into a reported failure.
 */
function removeWithRmdir(worktreePath: string): boolean {
	if (process.platform !== "win32") {
		return false;
	}

	try {
		io.execFileSync("cmd", ["/c", "rmdir", "/s", "/q", worktreePath], {
			stdio: ["ignore", "ignore", "ignore"],
			timeout: rmdirTimeoutMs,
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

/** Which log namespace a setup log belongs to, so issue and integration logs never collide. */
export type SetupLogKind = "issue" | "plain" | "integration";

/** Emits one human progress line; callers pass a `--json`-aware sink. */
export type EmitLine = (line: string) => void;

export interface SetupWorktreeOptions {
	dryRun?: boolean;
	/** Emits setup progress lines; defaults to `console.log`. */
	emit?: EmitLine;
	ignoreSetup?: boolean;
	/** Log namespace for `output: "log"`; defaults to `"plain"`. */
	logKind?: SetupLogKind;
	output?: SetupOutput;
	skipSetup?: boolean;
}

/** Rotate a setup log once it grows past this, keeping one previous generation. */
const setupLogMaxBytes = 5 * 1024 * 1024;

/** How many trailing log lines a failed setup prints back to the terminal. */
const setupFailureTailLines = 30;

/**
 * Log file for a worktree's setup command output.
 *
 * The kind prefix keeps an issue worktree and an integration worktree with the same basename from
 * sharing one append file — "which worktree was this?" is the first question asked of a setup log.
 *
 * - @param worktreePath - Worktree whose setup is being logged.
 * - @param kind - Log namespace; `"plain"` is a caller's own directory.
 * - @returns Absolute path under `logsDir`.
 */
export function setupLogPath(worktreePath: string, kind: SetupLogKind = "plain"): string {
	const name = basename(pathResolve(worktreePath));
	return pathResolve(
		logsDir,
		kind === "plain" ? `setup-${name}.log` : `setup-${kind}-${name}.log`,
	);
}

/**
 * Resolve where setup output goes: explicit option, then repository config, then the command
 * default. The standalone `sandcastle setup` command passes `"inherit"` as its default because a
 * human is waiting on that run; every agent path passes `"log"`.
 */
export function resolveSetupOutput(
	explicit: undefined | SetupOutput,
	commandDefault: SetupOutput,
): SetupOutput {
	return explicit ?? config.setupOutput ?? commandDefault;
}

/**
 * Start an append-mode log for one setup invocation.
 *
 * - @param logPath - File to append to.
 * - @returns An open file descriptor.
 * - @remarks Rotation keeps one previous generation (`<path>.1`); the cap bounds a pathological retry
 *   loop while preserving the previous run for comparison.
 */
function openSetupLog(logPath: string): number {
	try {
		mkdirSync(dirname(logPath), { recursive: true });
		if (existsSync(logPath) && statSync(logPath).size > setupLogMaxBytes) {
			renameSync(logPath, `${logPath}.1`);
		}

		return io.openSync(logPath, "a");
	} catch {
		return -1;
	}
}

/** Header written at the top of each invocation so a shared log stays readable. */
function setupLogHeader(command: string, worktreePath: string): string {
	return [
		`\n--- Setup started: ${formatRunStarted()} ---`,
		`$ ${command}`,
		`cwd: ${worktreePath}`,
		"",
	].join("\n");
}

/**
 * Last few lines of a setup log, for the failure path.
 *
 * - @param logPath - Log to read.
 * - @param lineCount - How many trailing non-empty lines to keep.
 * - @returns The tail, or `undefined` when the file is unreadable or empty.
 * - @remarks A hidden-output setup whose failure prints only `Command failed: <cmd>` leaves the
 *   operator nothing to act on, which is why the tail is read back rather than just the path.
 */
function readSetupLogTail(logPath: string, lineCount: number): string | undefined {
	let text: string;
	try {
		text = readFileSync(logPath, "utf-8");
	} catch {
		return undefined;
	}

	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
	if (lines.length === 0) {
		return undefined;
	}

	return lines.slice(-lineCount).join("\n");
}

/** `4m12s` / `38s` — enough precision to see a slow install, no false precision below a second. */
function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes === 0 ? `${String(seconds)}s` : `${String(minutes)}m${String(seconds)}s`;
}

/** Path relative to the repo root for display, falling back to the absolute path. */
function displayPath(target: string): string {
	const shown = relative(repoRoot, target);
	return shown === "" || shown.startsWith("..") ? target : shown;
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
 *
 * Setup output goes where `output` says: `"inherit"` streams it into the runner's own streams,
 * `"log"` appends it to a per-worktree file under `logsDir` and prints one announcing line before
 * the command plus one summary after it — an install that prints thousands of lines no longer
 * drowns the run.
 *
 * @returns The swallowed setup error when `ignoreSetup` absorbed one, else `undefined`. A setup
 *   failure the phase prompt never mentions sends the agent into free diagnostic work — the #498
 *   implement phase spent its whole budget diagnosing an environment main had already fixed — so
 *   the caller threads this into the prompt as a `{{SETUP_NOTE}}`.
 */
export function setupWorktree(
	worktreePath: string,
	{
		dryRun = false,
		emit = console.log,
		ignoreSetup = false,
		logKind = "plain",
		output = "inherit",
		skipSetup = false,
	}: SetupWorktreeOptions = {},
): string | undefined {
	ensureSetupDirs();

	const envSource = pathResolve(repoRoot, ".env");
	const setupCommand = config.setupCommands.join(" && ");
	const logPath = setupLogPath(worktreePath, logKind);

	if (dryRun) {
		console.log(
			JSON.stringify(
				{
					dirs: setupDirectories,
					env: existsSync(envSource) ? "copy" : "skip-missing",
					logPath: output === "log" ? displayPath(logPath) : undefined,
					runSetupCommands: !skipSetup && setupCommand !== "",
					setupCommands: config.setupCommands,
					setupOutput: output,
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
		return undefined;
	}

	emit("\n── Setup ──");

	if (existsSync(envSource)) {
		copyFileSync(envSource, pathResolve(worktreePath, ".env"));
		emit(`  ✓ Copied .env → ${pathResolve(worktreePath, ".env")}`);
	}

	let ignoredSetupError: string | undefined;
	if (skipSetup) {
		emit("  ⏭ Skipping setup commands.");
	} else if (setupCommand !== "") {
		if (output === "log") {
			ignoredSetupError = runSetupLogged({
				emit,
				ignoreSetup,
				logPath,
				setupCommand,
				worktreePath,
			});
		} else {
			try {
				io.execSync(setupCommand, { cwd: worktreePath, stdio: "inherit" });
			} catch (err) {
				if (!ignoreSetup) {
					throw err;
				}

				console.warn(`  ⚠ Setup failed (continuing): ${String(err)}`);
				ignoredSetupError = singleLine(err);
			}
		}
	}

	/*
	 * Symlinks are independent of the setup commands: always link them so agent docs/rules
	 * are available even when setup was skipped or failed and ignored.
	 */
	linkSymlinks(worktreePath);
	emit("  ✓ Setup complete.");
	return ignoredSetupError;
}

/**
 * Run the setup command with its output appended to `logPath` instead of the terminal.
 *
 * The announcing line prints before the command, so a silent multi-minute install explains itself
 * rather than reading as a hang. A log that cannot be opened degrades to `inherit` rather than
 * failing setup: a logging problem must never be the reason an environment goes unprepared.
 *
 * - @returns The swallowed setup error when `ignoreSetup` absorbed one, else `undefined`.
 */
function runSetupLogged({
	emit,
	ignoreSetup,
	logPath,
	setupCommand,
	worktreePath,
}: {
	emit: EmitLine;
	ignoreSetup: boolean;
	logPath: string;
	setupCommand: string;
	worktreePath: string;
}): string | undefined {
	const startedAt = Date.now();
	const fd = openSetupLog(logPath);

	if (fd === -1) {
		console.warn(`  ⚠ Could not open a setup log at ${logPath}; setup output is inherited.`);
		try {
			io.execSync(setupCommand, { cwd: worktreePath, stdio: "inherit" });
			emit(`  ✓ Setup commands finished (${formatDuration(Date.now() - startedAt)}).`);
			return undefined;
		} catch (err) {
			if (!ignoreSetup) {
				throw err;
			}

			console.warn(`  ⚠ Setup failed (continuing): ${String(err)}`);
			return singleLine(err);
		}
	}

	try {
		appendFileSync(fd, setupLogHeader(setupCommand, worktreePath));
	} catch {
		// Best-effort: a header that cannot be written must not stop the command.
	}

	emit(`  ▶ Running setup commands → ${displayPath(logPath)}`);

	let failure: unknown;
	try {
		/*
		 * `[fd, fd]` rather than `execSync`'s default pipes: a piped child buffers against Node's
		 * 1 MiB `maxBuffer`, and an install that talks past that is killed mid-way. stdin is
		 * ignored on purpose — a setup command waiting on a prompt would hang an unattended run.
		 */
		io.execSync(setupCommand, {
			cwd: worktreePath,
			stdio: ["ignore", fd, fd],
		});
	} catch (err) {
		failure = err;
	} finally {
		try {
			io.closeSync(fd);
		} catch {
			// Best-effort.
		}
	}

	if (failure === undefined) {
		emit(
			`  ✓ Setup commands finished (${formatDuration(Date.now() - startedAt)}) → ${displayPath(logPath)}`,
		);
		return undefined;
	}

	/*
	 * The log is the only place the real output exists now, but the error itself still carries
	 * useful facts (exit status, signal). Both go into the message: the summary line first, then
	 * the tail, so a failure reads the same whether or not the log captured anything.
	 */
	const tail = readSetupLogTail(logPath, setupFailureTailLines);
	const reason = singleLine(failure);
	const detail =
		tail === undefined
			? `  ⚠ Setup failed: ${reason}\n  ${displayPath(logPath)} is empty or unreadable.`
			: [
					`  ⚠ Setup failed: ${reason}`,
					`  Last ${String(setupFailureTailLines)} log line(s) from ${displayPath(logPath)}:`,
					tail
						.split(/\r?\n/)
						.map((line) => `    ${line}`)
						.join("\n"),
				].join("\n");

	if (!ignoreSetup) {
		throw new Error(`${detail}\n  Full output: ${logPath}`, { cause: failure });
	}

	console.warn(`${detail}\n  Continuing anyway (--ignore-setup).`);
	return `${reason} | log: ${displayPath(logPath)}`;
}

/** Flatten an error to a single bounded line so it fits inside a prompt block. */
function singleLine(err: unknown): string {
	const line = String(err)
		.split(/\r?\n/)
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.slice(0, 3)
		.join(" | ");
	return line.length > 500 ? `${line.slice(0, 497)}...` : line;
}

/**
 * Rebase a clean, stale worktree onto its base before setup runs.
 *
 * A persistent worktree is reused across runs without ever moving its branch, so a branch cut days
 * ago can carry work onto a base that has since moved — and setup commands against that stale base
 * fail on bugs the newer base has already fixed (#498 ran its install against a flux layout main
 * had replaced). Rebasing a clean tree before setup closes that gap; anything ambiguous (dirty
 * tree, conflicts, opt-out) leaves the worktree untouched and only warns, because a phase must
 * never fail on housekeeping.
 */
function rebaseStaleWorktree(worktreePath: string, baseRef: string): void {
	if ((process.env.SANDCASTLE_AUTO_REBASE ?? "").trim() === "0") {
		return;
	}

	/*
	 * Only a registered linked worktree qualifies. A plain directory — a test temp dir, a caller's
	 * scratch path — resolves git commands to whatever repository contains it, and rebasing that
	 * checkout would be a destructive surprise.
	 */
	if (
		registeredWorktrees().every(
			(wt) => normalizedPath(wt.path) !== normalizedPath(worktreePath),
		)
	) {
		return;
	}

	const staleCommits = countStaleCommits(worktreePath, baseRef);
	if (staleCommits === 0) {
		return;
	}

	if (gitTry(["status", "--porcelain"], worktreePath) !== "") {
		console.warn(
			`  ⚠ Worktree is ${String(staleCommits)} commits behind ${baseRef} but dirty — not rebasing; phases run against the stale base.`,
		);
		return;
	}

	try {
		git(["rebase", baseRef], worktreePath);
		console.log(`  ✓ Rebased onto ${baseRef} (was ${String(staleCommits)} commits behind).`);
	} catch (err) {
		gitTry(["rebase", "--abort"], worktreePath);
		console.warn(
			`  ⚠ Could not rebase onto ${baseRef} (rebase aborted, worktree untouched): ${String(err)}`,
		);
	}
}

export interface PrepareIssueWorktreeOptions {
	/** Emits setup progress lines; callers pass a `--json`-aware sink. */
	emit?: EmitLine;
	/** `--setup-output` value; falls back to repository config, then `"log"`. */
	output?: SetupOutput;
}
/**
 * Rebase a stale worktree onto its base, then prepare it for the issue phases.
 *
 * Setup output defaults to `"log"` here: an issue run is the automated path whose install output
 * used to drown the terminal.
 */
export function prepareIssueWorktree(
	worktreePath: string,
	ignoreSetup = false,
	skipSetup = false,
	baseRef?: string,
	options: PrepareIssueWorktreeOptions = {},
): string | undefined {
	rebaseStaleWorktree(worktreePath, baseRef ?? config.baseBranch);
	return setupWorktree(worktreePath, {
		emit: options.emit,
		ignoreSetup,
		logKind: "issue",
		output: resolveSetupOutput(options.output, "log"),
		skipSetup,
	});
}
