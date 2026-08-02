/*
 * Worktree lifecycle for the persistent issue sandbox: create/reuse registered
 * worktrees, link repository-local directories into them, and run the repo's
 * setup commands once per fresh worktree.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

import {
	checkoutBranch,
	git,
	gitTry,
	registeredWorktrees,
	resolveCommit,
} from "./git.js";
import { config, io, normalizedPath, repoRoot } from "./runtime.js";

export const sandboxProvider = noSandbox();

export interface PersistentSandbox {
	close(): Promise<void>;
	run(options: SandboxRunOptions): Promise<SandboxRunResult>;
	readonly worktreePath: string;
}

/** Create or reuse a worktree without invoking Sandcastle's prune lifecycle. */
export function ensurePersistentWorktree(branch: string, baseRef = "HEAD"): string {
	const worktreesDir = pathResolve(repoRoot, config.dir, "worktrees");
	const worktreePath = pathResolve(worktreesDir, branch.replace(/\//g, "-"));
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
			if (existsSync(linkPath) || lstatSync(linkPath, { throwIfNoEntry: false })) {
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
	copyFileSync(pathResolve(repoRoot, ".env"), pathResolve(worktreePath, ".env"));

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

export function createIssueSandbox(
	branchName: string,
	suppliedWorktree: undefined | { branch: string; path: string },
	baseRef: string | undefined,
): Promise<PersistentSandbox> {
	if (suppliedWorktree !== undefined) {
		return Promise.resolve({
			close: async () => undefined,
			run: async (runOptions: SandboxRunOptions) =>
				io.run({
					...runOptions,
					branchStrategy: { type: "head" },
					cwd: suppliedWorktree.path,
					sandbox: sandboxProvider,
				}),
			worktreePath: suppliedWorktree.path,
		});
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

export function prepareIssueWorktree(worktreePath: string, ignoreSetup = false): void {
	console.log("\n── Setup ──");
	const setupCommand = config.setupCommands.join(" && ");
	try {
		if (setupCommand !== "") {
			io.execSync(setupCommand, { cwd: worktreePath, stdio: "inherit" });
		}

		linkSymlinks(worktreePath);
		console.log("  ✓ Setup complete.");
	} catch (err) {
		if (ignoreSetup) {
			console.warn(`  ⚠ Setup failed (continuing): ${String(err)}`);
			return;
		}

		throw err;
	}
}
