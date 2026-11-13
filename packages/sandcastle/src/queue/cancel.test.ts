import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "vitest";

import { parseArgs } from "../cli.js";
import { config, io } from "../runtime.js";
import { ExitError, registerTestHooks, tmpRoot } from "../test-helpers.js";
import { runQueueCancel } from "./cancel.js";
import { runQueueCommand } from "./commands.js";
import { leaseRef } from "./lease.js";
import { batchLockName, queueLockPath, readLockOwner } from "./lock.js";

registerTestHooks();

/*
 * `queue cancel` takes no seams: it reads the real lock files and shells out to real git, exactly as
 * an operator would. These tests therefore give it an isolated checkout — `git rev-parse` is stubbed
 * to report a directory under the test tmp root — and a fake `origin` whose lease ref they control.
 */
const primary = join(tmpRoot, "cancel-primary");
const runLock = batchLockName("cancel-test-run");
const manifestLock = batchLockName("cancel-test-manifest");

/** One lease the fake remote holds, or `""` for none. */
let remote = "";
/** Commit message carried by the fake lease commit. */
let leaseMessage = "";

/** Writes a lock payload by hand, as a crashed run would leave it. */
function writeLock(name: string, owner: Record<string, unknown>): void {
	const path = queueLockPath(name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(owner), "utf-8");
}

/** Publishes a lease on the fake origin, as a dispatcher would. */
function publishLease(payload: Record<string, unknown>): void {
	remote = "lease-sha";
	leaseMessage = JSON.stringify(payload);
}

/**
 * - Models the git surface `queue cancel` reads: the common dir, `origin`, and the lease ref's CAS.
 * - @remarks A `push --force-with-lease` only succeeds against the sha the command just read, which
 *   is the property the command relies on to avoid clearing a lease acquired in the meantime.
 */
function stubGit(): void {
	io.execFileSync = ((command: string, args?: string | ReadonlyArray<string>) => {
		assert.equal(command, "git", "queue cancel must not shell out to anything else");
		const argv = Array.isArray(args) ? args.map(String) : [];
		const text = argv.join(" ");

		if (text.startsWith("rev-parse --path-format=absolute")) {
			return join(primary, ".git");
		}

		if (text === "remote") {
			return "origin\n";
		}

		if (text === `ls-remote origin ${leaseRef}`) {
			return remote === "" ? "" : `${remote}\t${leaseRef}`;
		}

		if (text.startsWith("fetch --quiet origin +")) {
			return "";
		}

		if (text.startsWith("rev-parse --verify")) {
			return remote === "" ? "" : `${remote}\n`;
		}

		if (text.startsWith("log -1 --format=%B")) {
			return `${leaseMessage}\n`;
		}

		if (text.startsWith("push ")) {
			const expected = argv
				.find((arg) => arg.startsWith("--force-with-lease="))
				?.split(`--force-with-lease=${leaseRef}:`)[1];
			assert.equal(expected, remote, "the delete must be a CAS against the sha just read");
			remote = "";
			return "";
		}

		if (text.startsWith("update-ref -d ")) {
			return "";
		}

		throw new Error(`unexpected git call: ${text}`);
	}) as typeof io.execFileSync;

	config.dir = "sandcastle.cancel-test";
}

/** Collects stdout and stderr so a test can read the human report. */
function capture(run: () => boolean): { output: string; value: boolean } {
	const lines: Array<string> = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = ((...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	}) as typeof console.log;
	console.error = (...args: Array<unknown>) => {
		lines.push(args.map(String).join(" "));
	};

	try {
		const value = run();
		return { output: lines.join("\n"), value };
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

const deadPid = 999_999;

afterEach(() => {
	rmSync(join(primary, config.dir), { force: true, recursive: true });
	remote = "";
	leaseMessage = "";
});

describe("queue cancel", () => {
	test("clears a dead run's locks and reports what it did", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: deadPid });
		writeLock(manifestLock, { at: Date.now(), host: hostname(), pid: deadPid });

		const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, true, "clearing everything is a success");
		assert.equal(readLockOwner(queueLockPath(runLock)), undefined);
		assert.equal(readLockOwner(queueLockPath(manifestLock)), undefined);
		assert.match(output, /✓ Cleared/u);
		assert.match(output, /No dispatch lease to clear/u);
	});

	test("keeps a live run's locks and says how to stop it", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: process.pid });

		const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, false, "refusing a live holder is exit 1");
		assert.equal(
			readLockOwner(queueLockPath(runLock))?.pid,
			process.pid,
			"the lock must remain",
		);
		assert.match(output, /Kept .*still running/u);
		assert.match(output, /Ctrl\+C/u);
	});

	test("clears a live holder's lock when --force says the operator knows better", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: process.pid });

		const { value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel", "--force"])));

		assert.equal(value, true);
		assert.equal(readLockOwner(queueLockPath(runLock)), undefined);
	});

	test("keeps a lock recorded on another host, whose pid cannot be probed from here", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: "another-machine", pid: 1 });

		const { value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, false);
		assert.ok(readLockOwner(queueLockPath(runLock)) !== undefined);
	});

	test("keeps a lock whose payload has not been written yet", () => {
		stubGit();
		const path = queueLockPath(runLock);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf-8");

		const { value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		/*
		 * A lock with no owner may be a live writer between `open` and `write`. This command is not in
		 * a hurry, so it leaves it: the dispatch's own age window is the right rule for judging it.
		 */
		assert.equal(value, false);
	});

	test("clears a dead holder's dispatch lease", () => {
		stubGit();
		publishLease({ at: Date.now(), branch: "main", host: hostname(), pid: deadPid });

		const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, true);
		assert.equal(remote, "", "the remote ref must actually be deleted");
		assert.match(
			output,
			new RegExp(`Cleared the dispatch lease of pid ${String(deadPid)}`, "u"),
		);
	});

	test("keeps a live holder's dispatch lease", () => {
		stubGit();
		publishLease({ at: Date.now(), branch: "main", host: hostname(), pid: process.pid });

		const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, false);
		assert.equal(remote, "lease-sha", "a live dispatcher keeps its lease");
		assert.match(output, /Kept the dispatch lease/u);
	});

	test("--force clears a live holder's dispatch lease too", () => {
		stubGit();
		publishLease({ at: Date.now(), branch: "main", host: hostname(), pid: process.pid });

		const { value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel", "--force"])));

		assert.equal(value, true);
		assert.equal(remote, "");
	});

	test("reports nothing to cancel when the checkout is clean", () => {
		stubGit();

		const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));

		assert.equal(value, true);
		assert.match(output, /Nothing to cancel/u);
	});

	test("--json emits one object describing every action", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: deadPid });
		publishLease({ at: Date.now(), branch: "main", host: hostname(), pid: deadPid });

		const { output } = capture(() => runQueueCancel(parseArgs(["queue", "cancel", "--json"])));

		const report = JSON.parse(output.slice(output.indexOf("{"))) as Record<string, unknown>;
		assert.equal(report.kind, "cancel");
		assert.equal(report.lease, "cleared");
		assert.deepEqual(report.cleared, [runLock]);
		assert.deepEqual(report.refused, []);
		assert.ok(Array.isArray(report.locks), "the per-lock detail is part of the payload");
	});

	test("the commands entry point exits 1 when a live holder was kept", () => {
		/*
		 * `runQueueCancel` returns whether anything was refused; the command group turns that into the
		 * exit code — the same split `queue check` uses, so a script can tell "clean" from "someone is
		 * running". This drives the real switch, so a missing `io.exit` there fails here.
		 */
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: process.pid });

		const codes: Array<number> = [];
		io.exit = (code: number): never => {
			codes.push(code);
			throw new ExitError(code);
		};

		assert.throws(
			() => runQueueCommand(parseArgs(["queue", "cancel"])),
			(err: unknown) => err instanceof ExitError,
		);
		assert.deepEqual(codes, [1]);
	});

	test("the commands entry point exits 0 when the checkout was cleaned", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: deadPid });

		const codes: Array<number> = [];
		io.exit = (code: number): never => {
			codes.push(code);
			throw new ExitError(code);
		};

		assert.doesNotThrow(() => {
			runQueueCommand(parseArgs(["queue", "cancel"]));
		});
		assert.deepEqual(codes, [], "a clean result leaves the exit code alone");
	});

	test("works with the queue disabled, because the residue outlives the workflow setting", () => {
		stubGit();
		writeLock(runLock, { at: Date.now(), host: hostname(), pid: deadPid });

		const { enabled } = config.queue;
		config.queue.enabled = false;

		try {
			const { output, value } = capture(() => runQueueCancel(parseArgs(["queue", "cancel"])));
			assert.equal(value, true);
			assert.match(output, /✓ Cleared/u);

			/*
			 * The command group must not short-circuit into "nothing to check" either: a repository that
			 * turned the queue off still has a lock and maybe a lease to clear, and saying otherwise
			 * would leave a later re-enable blocked.
			 */
			const codes: Array<number> = [];
			io.exit = (code: number): never => {
				codes.push(code);
				throw new ExitError(code);
			};

			assert.doesNotThrow(() => {
				runQueueCommand(parseArgs(["queue", "cancel"]));
			});
			assert.deepEqual(codes, []);
		} finally {
			config.queue.enabled = enabled;
		}
	});
});
