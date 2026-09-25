/*
 * Queue manifest persistence: where the manifest lives, and whether a write is published.
 *
 * The manifest is a shared, git-tracked file. A review agent running inside
 * `.sandcastle/worktrees/<branch>` must update the queue where it lives rather than a branch-local
 * copy that dies with the worktree. Committing is opt-in (`queue.commit` / `--queue-commit`) and
 * never pushes — the human still owns the merge.
 */

import type { CliOptions } from "../cli.js";
import { git, gitTry, mergeInProgress, primaryRepoRoot } from "../git.js";
import { config } from "../runtime.js";
import {
	inPrimaryWorktree,
	type QueueManifest,
	queueManifestPath,
	writeQueueManifest,
} from "./manifest.js";

/** Whether a successful mutation commits the manifest in the primary checkout. */
export function queueCommitEnabled(options: CliOptions): boolean {
	return options.queueCommit ?? config.queue.commit;
}

/** Prints where the manifest lives when the write leaves the current worktree. */
export function notifyQueueLocation(): void {
	if (inPrimaryWorktree()) {
		return;
	}

	console.log(`  ↳ Manifest: ${queueManifestPath()} (primary checkout)`);
}

/** Stages and commits only the manifest; skips when the checkout is mid-merge or already clean. */
export function commitQueueManifest(summary: string): void {
	const root = primaryRepoRoot();
	const path = queueManifestPath();
	if (mergeInProgress(root)) {
		console.warn(
			"  ⚠ Merge in progress in the primary checkout; leaving the manifest uncommitted.",
		);
		return;
	}

	if ((gitTry(["status", "--porcelain", "--", path], root) ?? "") === "") {
		return;
	}

	try {
		git(["add", "--", path], root);
		git(["commit", "-m", `chore(queue): ${summary}`, "--", path], root);
		console.log(`  ✓ Committed queue manifest (chore(queue): ${summary})`);
	} catch (err) {
		console.warn(`  ⚠ Could not commit the queue manifest: ${String(err)}`);
	}
}

/**
 * - Writes the manifest, reports its location, and commits it when the repository opts in.
 * - @param next - Manifest to persist.
 * - @param summary - Imperative phrase for the commit subject (`place #42 in the queue`).
 * - @param options - Parsed CLI options; `--dry-run` skips the write entirely.
 */
export function persistQueueManifest(
	next: QueueManifest,
	summary: string,
	options: CliOptions,
): void {
	if (options.dryRun) {
		console.log("  (dry run — manifest not written)");
		return;
	}

	writeQueueManifest(next);
	notifyQueueLocation();
	if (queueCommitEnabled(options)) {
		commitQueueManifest(summary);
	}
}
