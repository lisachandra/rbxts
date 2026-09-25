/*
 * Queue manifest persistence: where the manifest lives, and whether a write is published.
 *
 * The manifest is a shared, git-tracked file. A review agent running inside
 * `.sandcastle/worktrees/<branch>` must update the queue where it lives rather than a branch-local
 * copy that dies with the worktree. Committing is opt-in (`queue.commit` / `--queue-commit`) and
 * never pushes — the human still owns the merge.
 *
 * Every mutation goes through `transactQueueManifest`, which holds `manifestLockName` for the whole
 * read → mutate → write cycle: two writers (a review registering a follow-up and a human in another
 * terminal) therefore cannot lose each other's changes. The lock is short-lived by design so a
 * review running *inside* a dispatched batch never waits on the dispatcher.
 */

import type { CliOptions } from "../cli.js";
import { git, gitTry, mergeInProgress, primaryRepoRoot } from "../git.js";
import { config } from "../runtime.js";
import { manifestLockName, withQueueLock } from "./lock.js";
import {
	inPrimaryWorktree,
	type QueueManifest,
	queueManifestPath,
	readQueueManifest,
	writeQueueManifest,
} from "./manifest.js";

/** The outcome of one manifest transaction. */
export interface QueueTransaction {
	/** Line printed once the transaction settles, e.g. `✓ Placed #42 → sequence "U2"`. */
	message?: string;
	/** The mutated manifest; return the manifest you were given to mean "nothing to persist". */
	next: QueueManifest;
	/** Imperative phrase for the commit subject (`place #42 in the queue`). */
	summary: string;
}

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
 * - Runs one manifest transaction under the manifest lock.
 * - @param options - Parsed CLI options; `--dry-run` computes the mutation without writing.
 * - @param transact - Pure mutation applied to the manifest read inside the lock.
 * - @returns The manifest the transaction settled on.
 * - @remarks Returning the manifest unchanged (same reference) skips the write entirely, so a no-op
 *   like `queue prune` finding nothing cannot dirty a clean checkout.
 */
export function transactQueueManifest(
	options: CliOptions,
	transact: (manifest: QueueManifest) => QueueTransaction,
): QueueManifest {
	if (options.dryRun) {
		const { message, next } = transact(readQueueManifest());
		console.log("  (dry run — manifest not written)");
		if (message !== undefined) {
			console.log(message);
		}

		return next;
	}

	return withQueueLock({ name: manifestLockName }, () => {
		const current = readQueueManifest();
		const { message, next, summary } = transact(current);
		if (next !== current) {
			writeQueueManifest(next);
			notifyQueueLocation();
			if (queueCommitEnabled(options)) {
				commitQueueManifest(summary);
			}
		}

		if (message !== undefined) {
			console.log(message);
		}

		return next;
	});
}
