/*
 * Merger adapter for integration composition.
 *
 * Owns the git merge contract for integrations: clean-resolution assertions
 * (`assertCleanMergeResolution`), drift handling (`prepareWorktreeForMerge`,
 * `quarantineWorktreeDrift`), and the per-source merge loop
 * (`integrateManifestSource`). Every git/inspection primitive flows through an
 * injectable `MergerDeps` seam so tests can exercise conflict, merge-in-progress,
 * and drift branches without a live repo.
 */

import { git as defaultGit, gitTry as defaultGitTry } from "../git.js";
import type { IntegrationManifest } from "../types.js";
import { integrationBasePath } from "./manifest.js";

/** Injectable git/inspection seam for integration merge operations. */
export interface MergerDeps {
	changedSinceMergeBase: (worktree: string, commit: string) => Array<string>;
	dirtyPaths: (worktree: string) => Array<string>;
	git: (args: ReadonlyArray<string>, cwd?: string) => string;
	gitTry: (args: ReadonlyArray<string>, cwd?: string) => string | undefined;
	hasUnmergedPaths: (worktree: string) => boolean;
	isGitlink: (worktree: string, path: string) => boolean;
	mergeInProgress: (worktree: string) => boolean;
}

const defaultDeps: MergerDeps = {
	changedSinceMergeBase: () => [],
	dirtyPaths: () => [],
	git: defaultGit,
	gitTry: defaultGitTry,
	hasUnmergedPaths: () => false,
	isGitlink: () => false,
	mergeInProgress: () => false,
};

export function resolveMergerDeps(deps?: Partial<MergerDeps>): MergerDeps {
	return { ...defaultDeps, ...deps };
}

export function assertCleanMergeResolution(
	manifest: IntegrationManifest,
	deps: Partial<MergerDeps> = {},
): void {
	const merged = resolveMergerDeps(deps);
	const worktree = integrationBasePath(manifest);
	if (merged.hasUnmergedPaths(worktree)) {
		throw new Error(
			`Unmerged paths remain in ${worktree}; resolve every conflict before continuing.`,
		);
	}

	if (merged.mergeInProgress(worktree)) {
		merged.git(["commit", "--no-edit"], worktree);
	}
}
