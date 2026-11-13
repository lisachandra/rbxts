/*
 * Queue locking: advisory lock files that serialize the queue's read-modify-write cycles.
 *
 * Two names guard two different things:
 * - `manifestLockName` is held only around a single manifest transaction (read → mutate → write →
 *   optional commit). A review agent registering a follow-up takes it for milliseconds, so it never
 *   waits on a batch.
 * - `runLockName` is held by `queue run` for the whole invocation, which is what makes its in-memory
 *   `seen` set a complete view of the issues this checkout has in flight. Dispatchers therefore
 *   never overlap, and a serialization rule (`R<n>`) cannot be violated by a second dispatcher
 *   starting halfway through the first. Mutations deliberately ignore this lock: a review running
 *   *inside* a batch must still be able to register its follow-ups.
 *
 * Locks live in the primary checkout's queue directory (`.sandcastle/` by default), never in a
 * worktree: every worktree of a repository shares one queue manifest, so it must share one lock.
 * A lock whose owner died is stolen after `staleMs`, so a crashed run cannot wedge the queue
 * forever.
 */

import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve as pathResolve } from "node:path";

import { primaryRepoRoot } from "../git.js";
import { config } from "../runtime.js";

/** Lock held around one manifest transaction. */
export const manifestLockName = "queue-manifest.lock";
/** Lock held by a `queue run` invocation for its whole lifetime. */
export const runLockName = "queue-run.lock";

/**
 * - Lock name guarding one batch's execution.
 * - @param name - The batch (integration) name.
 * - @returns A lock file name unique to that batch.
 * - @remarks A `--parallel` lane runs its batch in its own process, so it cannot rely on the parent's
 *   `runLockName` to keep a second dispatcher off that batch: without this, `queue run --name
 *   <batch>` in another terminal would run the same members against the same worktrees. The parent
 *   still holds `runLockName`, so the two locks are nested rather than merged — a batch lock alone
 *   is what makes a single lane safe to hand a name it binds.
 */
export function batchLockName(name: string): string {
	return `queue-batch-${name.replace(/[^A-Za-z0-9._-]/gu, "-")}.lock`;
}

/** Ten minutes: longer than any mutation, shorter than a human's patience. */
const defaultStaleMs = 10 * 60 * 1000;

/**
 * How long an unreadable lock file is left alone.
 *
 * A lock is created with `O_EXCL` and the payload written immediately after, so a file that does
 * not parse is almost always one caught in that gap. Treating it as abandoned would let a second
 * dispatcher steal a lock whose owner is still alive.
 */
const unreadableGraceMs = 5_000;

interface LockOwner {
	/** Epoch milliseconds at which the lock was taken. */
	at: number;
	host: string;
	pid: number;
}

export interface QueueLockOptions {
	/** Pid liveness probe; defaults to the process table. Tests inject a stub. */
	isAlive?: (pid: number) => boolean;
	/** Lock file name, e.g. `manifestLockName`. */
	name: string;
	/**
	 * Milliseconds after which a lock may be stolen; defaults to ten minutes.
	 *
	 * The age window is the fallback for an owner this process cannot vouch for — another host, or
	 * a pid that cannot be probed. A lock whose owner is on this host and provably gone is
	 * reclaimed immediately instead of waiting it out.
	 */
	staleMs?: number;
}

/** Absolute path of a queue lock file, resolved against the primary checkout. */
export function queueLockPath(name: string): string {
	return pathResolve(primaryRepoRoot(), config.dir, name);
}

/** Reads the lock file's owner, or `undefined` when it is absent or unreadable. */
function lockOwner(path: string): undefined | LockOwner {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof parsed !== "object" || parsed === null) {
			return undefined;
		}

		const at = Reflect.get(parsed, "at");
		const host = Reflect.get(parsed, "host");
		const pid = Reflect.get(parsed, "pid");
		if (typeof at !== "number" || typeof host !== "string" || typeof pid !== "number") {
			return undefined;
		}

		return { at, host, pid };
	} catch {
		return undefined;
	}
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}

/**
 * - Probes whether a pid is running on this host.
 * - @param pid - Process id recorded in a lock or lease payload.
 * - @returns `false` only when the process table says the pid does not exist.
 * - @remarks `EPERM` means the pid exists but belongs to someone this process may not signal, so it
 *   counts as alive: reclaiming a lock whose owner is running is far worse than waiting out the age
 *   window. An unexpected error is likewise treated as alive, for the same reason.
 */
export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return errorCode(err) !== "ESRCH";
	}
}

/**
 * - Whether a recorded owner is both on this host and provably gone.
 * - @param owner - The payload recorded in a lock file.
 * - @param isAlive - Pid liveness probe; defaults to the process table.
 * - @returns `true` only when the owner is on this host and its pid no longer exists.
 * - @remarks Exported so `queue cancel` uses the same rule as dispatch. Two copies of "is this
 *   reclaimable" would drift, and the command and the next run would disagree about which residue
 *   may be cleared — the one disagreement an operator would not be able to resolve.
 */
export function ownerIsDead(
	owner: { readonly host: string; readonly pid: number },
	isAlive: (pid: number) => boolean = isPidAlive,
): boolean {
	return owner.host === hostname() && !isAlive(owner.pid);
}

/** Human description of a lock file's owner, for `queue cancel` and a refusal. */
export function describeLockOwner(path: string): string {
	return describe(lockOwner(path));
}

/** The owner recorded in a lock file, or `undefined` when it is absent or unreadable. */
export function readLockOwner(path: string): undefined | { at: number; host: string; pid: number } {
	return lockOwner(path);
}

function describe(owner: undefined | LockOwner): string {
	if (owner === undefined) {
		return "an unknown process";
	}

	const age = Math.round((Date.now() - owner.at) / 1000);
	return `pid ${owner.pid} on ${owner.host}, started ${age}s ago`;
}

/**
 * - Acquires a queue lock.
 * - @param options - Lock name, staleness window, and pid-liveness seam.
 * - @returns The release function; call it in a `finally` block.
 * - @throws {Error} When a live process holds the lock.
 * - @remarks Two attempts only: the first may steal an abandoned lock, the second either wins or
 *   reports the live owner. Stealing is announced on stderr because it means some other run died
 *   holding it.
 *
 *   An owner that is on this host and whose pid no longer exists is reclaimed immediately rather than
 *   after the age window — a cancelled or crashed run is the common case, and making the operator
 *   wait ten minutes for it is the whole complaint this covers.
 */
export function acquireQueueLock(options: QueueLockOptions): () => void {
	const path = queueLockPath(options.name);
	const staleMs = options.staleMs ?? defaultStaleMs;
	const isAlive = options.isAlive ?? isPidAlive;
	mkdirSync(dirname(path), { recursive: true });

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = openSync(path, "wx");
			try {
				const owner: LockOwner = { at: Date.now(), host: hostname(), pid: process.pid };
				writeFileSync(handle, JSON.stringify(owner));
			} finally {
				closeSync(handle);
			}

			return () => {
				rmSync(path, { force: true });
			};
		} catch (err) {
			if (errorCode(err) !== "EEXIST") {
				throw err;
			}
		}

		const owner = lockOwner(path);
		if (owner === undefined) {
			/*
			 * No payload yet: either a live writer caught between `open` and `write`, or the debris of a
			 * write that never landed. Only the second is safe to steal, and age is the only thing that
			 * distinguishes them.
			 */
			const age = Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0);
			if (age < unreadableGraceMs) {
				throw new Error(
					`${path} exists but its owner has not been written yet; retry in a moment.`,
				);
			}

			console.error(
				`  ⚠ Stealing unreadable queue lock ${path}; it has no owner payload after ${String(Math.round(age / 1000))}s.`,
			);
			rmSync(path, { force: true });
			continue;
		}

		if (ownerIsDead(owner, isAlive)) {
			console.error(
				`  ⚠ Reclaiming queue lock ${path} (${describe(owner)}); that process is no longer running.`,
			);
			rmSync(path, { force: true });
			continue;
		}

		if (Date.now() - owner.at >= staleMs) {
			console.error(
				`  ⚠ Stealing stale queue lock ${path} (${describe(owner)}); the previous run did not release it.`,
			);
			rmSync(path, { force: true });
			continue;
		}

		throw new Error(
			`Another sandcastle queue command holds ${path} (${describe(owner)}); retry once it finishes.`,
		);
	}

	throw new Error(
		`Could not acquire the queue lock at ${path}; remove it if no queue run is active.`,
	);
}

/**
 * - Runs `fn` while holding a queue lock.
 * - @param options - Lock name and the staleness window.
 * - @param fn - Synchronous critical section; use `acquireQueueLock` for async work.
 * - @returns Whatever `fn` returns.
 */
export function withQueueLock<T>(options: QueueLockOptions, fn: () => T): T {
	const release = acquireQueueLock(options);
	try {
		return fn();
	} finally {
		release();
	}
}

/** One lock file found in the queue directory. */
export interface QueueLockFile {
	/** Recorded owner, or `undefined` when the payload is absent or unreadable. */
	owner?: LockOwner;
	/** Absolute path of the lock file. */
	path: string;
}

/**
 * - Lists every queue lock file present in this checkout.
 * - @returns The run lock, the manifest lock, and every batch lock, in name order.
 * - @remarks Batch locks are named per batch, so they cannot be listed from constants: they are found
 *   by prefix in the state directory. `queue cancel` is the caller that needs the whole set,
 *   because a crashed run leaves whichever of them it happened to be holding.
 */
export function listQueueLocks(): Array<QueueLockFile> {
	const directory = pathResolve(primaryRepoRoot(), config.dir);
	let entries: Array<string>;
	try {
		entries = readdirSync(directory);
	} catch {
		return [];
	}

	return entries
		.filter(
			(entry) =>
				entry === manifestLockName ||
				entry === runLockName ||
				(entry.startsWith("queue-batch-") && entry.endsWith(".lock")),
		)
		.sort()
		.map((entry) => {
			const path = pathResolve(directory, entry);
			const owner = lockOwner(path);
			return owner === undefined ? { path } : { owner, path };
		});
}
