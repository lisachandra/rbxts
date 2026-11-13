/*
 * `queue cancel`: clear what a run that is gone left behind.
 *
 * The signal-based path (`Ctrl+C`) releases everything itself, so this command exists for the case
 * where the terminal that owned the run is no longer there: a closed window, a killed IDE, a crashed
 * process. What it clears is only the *residue* — the dispatch lease on `origin` and the lock files
 * in `.sandcastle/`. It never signals a process: a live run is stopped from its own terminal, where
 * `Ctrl+C` can unwind it properly.
 *
 * Refusing on a live holder is the point. A lock whose owner is mid-write protects a manifest
 * read-modify-write, and clearing it would let two dispatchers interleave. `--force` exists for the
 * operator who knows better — a stale process table entry, or a run stuck in a way no signal
 * reaches — and it says out loud what it is doing.
 */

import { rmSync } from "node:fs";

import type { CliOptions } from "../cli.js";
import { clearStaleLease } from "./lease.js";
import { describeLockOwner, listQueueLocks, ownerIsDead, readLockOwner } from "./lock.js";
import { emitJson, emitText } from "./output.js";

/** One lock file this command looked at. */
interface LockReport {
	/** What was done to it. */
	action: "absent" | "cleared" | "refused";
	/** Lock file name, e.g. `queue-run.lock`. */
	name: string;
	/** Human description of the recorded owner. */
	owner: string;
	/** Absolute path of the lock file. */
	path: string;
}

/** What one `queue cancel` invocation did. */
export interface CancelReport {
	/** Locks cleared, in name order. */
	cleared: Array<string>;
	/** What happened to the published dispatch lease. */
	lease: "absent" | "cleared" | "refused";
	/** Locks kept because their owner is still running. */
	refused: Array<string>;
}

/**
 * - Clears a dead run's lock files and dispatch lease.
 * - @param options - Parsed CLI options; `--force` clears a live holder's residue too.
 * - @returns Whether anything was refused, which decides the exit code.
 * - @remarks Exit 0 when the residue was cleared or there was none, 1 when a live holder was kept —
 *   the same shape as `queue check`, so a script can tell "clean" from "someone is running".
 */
export function runQueueCancel(options: CliOptions): boolean {
	const force = options.force === true;
	const locks = inspectLocks(force);
	const lease = clearStaleLease({ force });

	const report: CancelReport = {
		cleared: locks.filter((lock) => lock.action === "cleared").map((lock) => lock.name),
		lease: lease.kind,
		refused: locks.filter((lock) => lock.action === "refused").map((lock) => lock.name),
	};
	if (options.jsonOut) {
		emitJson({ kind: "cancel", ...report, locks });
	} else {
		reportText(options, locks, lease);
	}

	return report.refused.length === 0 && report.lease !== "refused";
}

/** Clears or keeps every queue lock file, recording why. */
function inspectLocks(force: boolean): Array<LockReport> {
	const reports: Array<LockReport> = [];
	for (const lock of listQueueLocks()) {
		const name = lock.path.split(/[\\/]/u).at(-1) ?? lock.path;
		const owner = describeLockOwner(lock.path);

		/*
		 * An owner recorded on another host cannot be probed, and an unrecorded owner may be a writer
		 * between `open` and `write`. Both are kept unless `--force`: the age window that a dispatch
		 * applies is the right rule there, and this command is not in a hurry. The same predicate
		 * dispatch uses decides "gone", so the two can never disagree about what is reclaimable.
		 */
		const recorded = readLockOwner(lock.path);
		const deadHere = recorded !== undefined && ownerIsDead(recorded);
		if (!force && !deadHere) {
			reports.push({ action: "refused", name, owner, path: lock.path });
			continue;
		}

		try {
			rmSync(lock.path, { force: true });
			reports.push({ action: "cleared", name, owner, path: lock.path });
		} catch {
			reports.push({ action: "refused", name, owner, path: lock.path });
		}
	}

	return reports;
}

/** Prints the human account: what was cleared, what kept its owner, and what to do next. */
function reportText(
	options: CliOptions,
	locks: ReadonlyArray<LockReport>,
	lease: ReturnType<typeof clearStaleLease>,
): void {
	for (const lock of locks) {
		if (lock.action === "cleared") {
			emitText(options, `  ✓ Cleared ${lock.name} (${lock.owner}).`);
		} else {
			emitText(options, `  ⏭ Kept ${lock.name}: ${lock.owner} is still running.`);
		}
	}

	switch (lease.kind) {
		case "absent": {
			emitText(options, "  ✓ No dispatch lease to clear.");
			break;
		}
		case "cleared": {
			emitText(
				options,
				`  ✓ Cleared the dispatch lease of pid ${String(lease.holder.pid)} on ${lease.holder.host}.`,
			);
			break;
		}
		case "refused": {
			emitText(
				options,
				`  ⏭ Kept the dispatch lease: pid ${String(lease.holder.pid)} on ${lease.holder.host} is still running.`,
			);
			break;
		}
	}

	if (locks.length === 0 && lease.kind === "absent") {
		emitText(options, "  ✓ Nothing to cancel: no queue locks and no dispatch lease.");
	}

	if (locks.some((lock) => lock.action === "refused") || lease.kind === "refused") {
		emitText(
			options,
			"    Stop the run from its own terminal with Ctrl+C, or pass --force to clear its locks anyway.",
		);
	}
}
