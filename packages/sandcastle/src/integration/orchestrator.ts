/*
 * Orchestrator for integration composition.
 *
 * Owns the state transition engine for `continueIntegration`
 * (merging → conflict-resolution-required → integrated → reviewing →
 * review-passed → ready-for-human-merge, plus review-failed/blocked), the
 * marker-backed agent phases (conflict resolver, integration review), and the
 * shared worktree preparation seam that delegates to `setupWorktree`.
 */

import { setupWorktree } from "../worktree.js";
import type { SetupWorktreeOptions } from "../worktree.js";

export type { SetupWorktreeOptions } from "../worktree.js";

/**
 * Prepare an integration worktree before agents run, delegating to the shared `setupWorktree`
 * (`.env` copy, `setupCommands`, and symlinked dirs) so issue and integration paths stay uniform.
 */
export function prepareIntegrationWorktree(
	worktree: string,
	ignoreSetup: boolean,
	skipSetup: boolean,
	worktreePreparer: (path: string, options: SetupWorktreeOptions) => void = setupWorktree,
): void {
	const preparer = worktreePreparer ?? setupWorktree;
	preparer(worktree, { ignoreSetup, skipSetup });
}
