/*
 * Thin git plumbing shared by the issue runner, sequential workflow, and
 * integration composition. Everything goes through `io` so tests can stub it.
 */

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { io, repoRoot } from "./runtime.js";

export interface RegisteredWorktree {
	branch: string | undefined;
	path: string;
}

export function git(args: ReadonlyArray<string>, cwd = repoRoot): string {
	return io
		.execFileSync("git", [...args], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
		.toString()
		.trim();
}

export function gitTry(args: ReadonlyArray<string>, cwd = repoRoot): string | undefined {
	try {
		return git(args, cwd);
	} catch {
		return undefined;
	}
}

export function resolveCommit(ref: string, cwd = repoRoot): string {
	// oxlint-disable-next-line unicorn-js/no-incorrect-template-string-interpolation -- git commit peel syntax
	const commit = git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
	if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
		throw new Error(`Git ref did not resolve to a commit: ${ref}`);
	}

	return commit;
}

export function commitExists(commit: string, cwd = repoRoot): boolean {
	// oxlint-disable-next-line unicorn-js/no-incorrect-template-string-interpolation -- git commit peel syntax
	return gitTry(["cat-file", "-e", `${commit}^{commit}`], cwd) !== undefined;
}

export function countNewCommits(worktreePath: string, baseRef: string): number {
	try {
		const output = io
			.execSync(`git rev-list --count HEAD --not ${baseRef}`, {
				cwd: worktreePath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 5000,
			})
			.toString()
			.trim();
		return Number(output);
	} catch {
		return 0;
	}
}

export function hasUnmergedPaths(worktree: string): boolean {
	return git(["diff", "--name-only", "--diff-filter=U"], worktree).length > 0;
}

export function mergeHeadPath(worktree: string): string {
	const gitDir = git(["rev-parse", "--git-dir"], worktree);
	const absoluteGitDir =
		/^[A-Za-z]:[\\/]/.test(gitDir) || gitDir.startsWith("/")
			? gitDir
			: pathResolve(worktree, gitDir);
	return pathResolve(absoluteGitDir, "MERGE_HEAD");
}

export const mergeInProgress = (worktree: string): boolean => existsSync(mergeHeadPath(worktree));

export function registeredWorktrees(): Array<RegisteredWorktree> {
	return git(["worktree", "list", "--porcelain"])
		.split(/\r?\n\r?\n/)
		.map((block) => {
			const pathLine = block.split(/\r?\n/).find((line) => line.startsWith("worktree "));
			if (pathLine === undefined || pathLine === "") {
				return undefined;
			}

			const branchLine = block.split(/\r?\n/).find((line) => line.startsWith("branch "));
			return {
				branch: branchLine?.slice("branch ".length).replace(/^refs\/heads\//, ""),
				path: pathLine.slice("worktree ".length),
			};
		})
		.filter((worktree): worktree is RegisteredWorktree => worktree !== undefined);
}

export function checkoutBranch(worktreePath: string): string | undefined {
	if (!existsSync(worktreePath)) {
		return undefined;
	}

	const gitDir = gitTry(["-C", worktreePath, "rev-parse", "--git-dir"]);
	if (gitDir === undefined || gitDir === "") {
		return undefined;
	}

	return gitTry(["-C", worktreePath, "symbolic-ref", "--quiet", "--short", "HEAD"]);
}
