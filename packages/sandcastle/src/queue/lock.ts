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

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve as pathResolve } from "node:path";

import { primaryRepoRoot } from "../git.js";
import { config } from "../runtime.js";

/** Lock held around one manifest transaction. */
export const manifestLockName = "queue-manifest.lock";
/** Lock held by a `queue run` invocation for its whole lifetime. */
export const runLockName = "queue-run.lock";

/** Ten minutes: longer than any mutation, shorter than a human's patience. */
const defaultStaleMs = 10 * 60 * 1000;

interface LockOwner {
	/** Epoch milliseconds at which the lock was taken. */
	at: number;
	host: string;
	pid: number;
}

export interface QueueLockOptions {
	/** Lock file name, e.g. `manifestLockName`. */
	name: string;
	/** Milliseconds after which a lock may be stolen; defaults to ten minutes. */
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

function describe(owner: undefined | LockOwner): string {
	if (owner === undefined) {
		return "an unknown process";
	}

	const age = Math.round((Date.now() - owner.at) / 1000);
	return `pid ${owner.pid} on ${owner.host}, started ${age}s ago`;
}

/**
 * - Acquires a queue lock.
 * - @param options - Lock name and the staleness window.
 * - @returns The release function; call it in a `finally` block.
 * - @throws {Error} When a live process holds the lock.
 * - @remarks Two attempts only: the first may steal a stale lock, the second either wins or reports
 *   the live owner. Stealing is announced on stderr because it means some other run died holding
 *   it.
 */
export function acquireQueueLock(options: QueueLockOptions): () => void {
	const path = queueLockPath(options.name);
	const staleMs = options.staleMs ?? defaultStaleMs;
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
		if (owner === undefined || Date.now() - owner.at >= staleMs) {
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
