import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { afterEach, describe, test } from "vitest";

import { registerTestHooks } from "../test-helpers.js";
import {
	acquireQueueLock,
	batchLockName,
	describeLockOwner,
	isPidAlive,
	listQueueLocks,
	queueLockPath,
	readLockOwner,
	withQueueLock,
} from "./lock.js";

registerTestHooks();

/*
 * Every lock this file touches is a batch lock under a name only it uses. `runLockName` and
 * `manifestLockName` are deliberately avoided: `run.test.ts` and `ops.test.ts` take those against
 * the same checkout, and the suite runs files in parallel processes.
 */
const deadOwner = batchLockName("lock-test-dead");
const liveOwner = batchLockName("lock-test-live");
const remoteOwner = batchLockName("lock-test-remote");
const unreadable = batchLockName("lock-test-unreadable");
const malformed = batchLockName("lock-test-malformed");
const thrower = batchLockName("lock-test-thrower");
const listed = batchLockName("lock-test-listed");

const owned = [deadOwner, liveOwner, remoteOwner, unreadable, malformed, thrower, listed];

/** Writes a lock payload by hand, as a crashed run would leave it. */
function writeLock(name: string, owner: Record<string, unknown>): string {
	const path = queueLockPath(name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(owner), "utf-8");
	return path;
}

/** Runs `fn`, returning everything written to stderr so a test can read a warning. */
function captureStderr<T>(fn: () => T): { error: string; value: T } {
	const lines: Array<string> = [];
	const original = console.error;
	console.error = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		const value = fn();
		return { error: lines.join("\n"), value };
	} finally {
		console.error = original;
	}
}

afterEach(() => {
	for (const name of owned) {
		rmSync(queueLockPath(name), { force: true });
	}
});

describe("pid liveness", () => {
	test("a pid that cannot exist reads as dead", () => {
		assert.equal(isPidAlive(0), false);
		assert.equal(isPidAlive(-1), false);
		assert.equal(isPidAlive(2_147_483_646), false);
	});

	test("this process reads as alive", () => {
		assert.equal(isPidAlive(process.pid), true);
	});
});

describe("queue lock acquisition", () => {
	test("takes a free lock, records its owner, and releases it", () => {
		const release = acquireQueueLock({ name: deadOwner });

		try {
			const owner = readLockOwner(queueLockPath(deadOwner));
			assert.equal(owner?.pid, process.pid);
			assert.equal(owner?.host, hostname());
			assert.equal(typeof owner?.at, "number");
		} finally {
			release();
		}

		assert.equal(readLockOwner(queueLockPath(deadOwner)), undefined);
	});

	test("refuses a lock its owner is still running, naming the owner and the path", () => {
		writeLock(liveOwner, { at: Date.now(), host: hostname(), pid: process.pid });

		assert.throws(
			() => acquireQueueLock({ isAlive: () => true, name: liveOwner }),
			(err: unknown) =>
				err instanceof Error &&
				/Another sandcastle queue command holds/u.test(err.message) &&
				err.message.includes(queueLockPath(liveOwner)) &&
				new RegExp(`pid ${String(process.pid)} on ${hostname()}`, "u").test(err.message),
		);
	});

	test("reclaims a same-host lock whose owner is gone, without waiting out the window", () => {
		writeLock(deadOwner, { at: Date.now(), host: hostname(), pid: 999_999 });

		const { error, value } = captureStderr(() =>
			acquireQueueLock({ isAlive: () => false, name: deadOwner }),
		);

		assert.match(error, /Reclaiming queue lock/u);
		assert.match(error, /that process is no longer running/u);
		assert.equal(readLockOwner(queueLockPath(deadOwner))?.pid, process.pid);

		value();
	});

	test("a lock held on another host is respected until the age window passes", () => {
		/* Fresh, and its pid cannot be probed from here, so it must be respected. */
		writeLock(remoteOwner, { at: Date.now(), host: "another-machine", pid: 1 });

		const refused = captureStderr(() => {
			assert.throws(
				() => acquireQueueLock({ isAlive: () => false, name: remoteOwner }),
				/Another sandcastle queue command holds/u,
			);
		});
		assert.equal(refused.error, "", "refusing a live holder is not a warning");

		writeLock(remoteOwner, {
			at: Date.now() - 11 * 60 * 1000,
			host: "another-machine",
			pid: 1,
		});
		const stolen = captureStderr(() =>
			acquireQueueLock({ isAlive: () => false, name: remoteOwner, staleMs: 10 * 60 * 1000 }),
		);

		assert.match(stolen.error, /Stealing stale queue lock/u);
		assert.match(stolen.error, /the previous run did not release it/u);
		stolen.value();
	});

	test("a same-host owner the probe calls alive still falls back to the age window", () => {
		writeLock(liveOwner, { at: Date.now() - 60_000, host: hostname(), pid: 999_999 });

		assert.throws(
			() =>
				acquireQueueLock({ isAlive: () => true, name: liveOwner, staleMs: 5 * 60 * 1000 }),
			/Another sandcastle queue command holds/u,
		);

		const { value } = captureStderr(() =>
			acquireQueueLock({ isAlive: () => true, name: liveOwner, staleMs: 30_000 }),
		);
		value();
	});

	test("an unreadable lock is refused while it may still be a live writer", () => {
		const path = queueLockPath(unreadable);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf-8");

		assert.throws(
			() => acquireQueueLock({ name: unreadable }),
			/owner has not been written yet; retry in a moment/u,
		);
	});

	test("an unreadable lock older than the grace window is debris and is stolen", () => {
		const path = queueLockPath(unreadable);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf-8");
		/* The grace period is measured from the file's mtime, so backdate it. */
		const old = new Date(Date.now() - 60_000);
		utimesSync(path, old, old);

		const { error } = captureStderr(() => {
			acquireQueueLock({ name: unreadable })();
		});

		assert.match(error, /Stealing unreadable queue lock/u);
		assert.match(error, /no owner payload after \d+s/u);
	});

	test("a payload that does not describe an owner is treated as unreadable", () => {
		const path = queueLockPath(malformed);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, '{"pid": "not-a-number"}', "utf-8");

		assert.throws(() => acquireQueueLock({ name: malformed }), /owner has not been written/u);
	});

	test("withQueueLock releases even when the body throws", () => {
		assert.throws(() => {
			withQueueLock({ name: thrower }, () => {
				throw new Error("boom");
			});
		}, /boom/u);
		assert.equal(readLockOwner(queueLockPath(thrower)), undefined);
	});
});

describe("lock listing", () => {
	test("finds the batch locks present in the checkout and no unrelated file", () => {
		const first = acquireQueueLock({ name: listed });
		const second = acquireQueueLock({ name: batchLockName("lock-test-listed-2") });

		try {
			const paths = listQueueLocks().map((lock) => lock.path);
			assert.ok(paths.includes(queueLockPath(listed)), `no ${listed} in ${paths.join(", ")}`);
			assert.ok(paths.includes(queueLockPath(batchLockName("lock-test-listed-2"))));
			for (const path of paths) {
				assert.match(
					path.split(/[\\/]/u).at(-1) ?? "",
					/^queue-(?:run|manifest|batch-.+)\.lock$/u,
					"a lock listing must never include unrelated files",
				);
			}
		} finally {
			first();
			second();
		}
	});

	test("a listed lock carries its parsed owner", () => {
		const release = acquireQueueLock({ name: listed });

		try {
			const entry = listQueueLocks().find((lock) => lock.path === queueLockPath(listed));
			assert.equal(entry?.owner?.pid, process.pid);
			assert.equal(entry?.owner?.host, hostname());
			assert.equal(typeof entry?.owner?.at, "number");
		} finally {
			release();
		}
	});

	test("describeLockOwner names the owner, or admits it does not know", () => {
		const release = acquireQueueLock({ name: listed });

		try {
			const described = describeLockOwner(queueLockPath(listed));
			assert.match(described, new RegExp(`pid ${String(process.pid)}`, "u"));
			assert.match(described, /started \d+s ago/u);
		} finally {
			release();
		}

		assert.equal(describeLockOwner(queueLockPath(listed)), "an unknown process");
	});

	test("a lock file whose payload has no owner is listed with no owner", () => {
		const path = queueLockPath(malformed);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "not json", "utf-8");

		const entry = listQueueLocks().find((lock) => lock.path === path);
		assert.ok(entry !== undefined);
		assert.equal(entry.owner, undefined);
	});

	test("listing a checkout with no queue directory returns nothing", () => {
		assert.doesNotThrow(() => {
			assert.ok(Array.isArray(listQueueLocks()));
		});
	});
});

describe("lock payload", () => {
	test("holds nothing but at, host, and pid", () => {
		const release = acquireQueueLock({ name: listed });

		try {
			const raw = JSON.parse(readFileSync(queueLockPath(listed), "utf-8")) as Record<
				string,
				unknown
			>;
			assert.deepEqual(Object.keys(raw).sort(), ["at", "host", "pid"]);
		} finally {
			release();
		}
	});
});
