import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { acquireDispatchLease, type LeasePayload, leaseRef, leaseTtlMs } from "./lease.js";

/** Recorded `git` invocation, so a test can assert both the effect and the shape of the CAS. */
interface Call {
	args: ReadonlyArray<string>;
}

/**
 * A fake git that models just the ref state the lease touches.
 *
 * `remote` is `origin`'s copy of the lease ref; `local` is this checkout's. A `push` fails unless
 * its `--force-with-lease` expectation matches the remote, which is exactly the property the real
 * guard relies on — so these tests exercise the CAS discipline rather than a mock of it.
 */
class FakeGit {
	public readonly calls: Array<Call> = [];
	public local = "";
	public remote = "";
	/** Set to make every push fail with a transport error instead of a CAS rejection. */
	public transportDown = false;
	public payloadOf: (sha: string) => string = (sha) => this.messages.get(sha) ?? "";

	public readonly run = (args: ReadonlyArray<string>): string => {
		this.calls.push({ args });
		const command = args.join(" ");

		if (command === "remote") {
			return this.hasOrigin ? "origin\n" : "";
		}

		if (command === `ls-remote origin ${leaseRef}`) {
			return this.remote === "" ? "" : `abc123\t${leaseRef}`;
		}

		if (command.startsWith("fetch --quiet origin +")) {
			this.local = this.remote;
			return "";
		}

		if (command.startsWith("update-ref -d ")) {
			this.local = "";
			return "";
		}

		if (command.startsWith("update-ref ")) {
			this.local = args[2] ?? "";
			return "";
		}

		if (command.startsWith("rev-parse --abbrev-ref HEAD")) {
			return "main\n";
		}

		if (command.startsWith("rev-parse --verify")) {
			return this.local === "" ? "" : `${this.local}\n`;
		}

		if (command.startsWith("log -1 --format=%B")) {
			return this.payloadOf(args[3] ?? "");
		}

		if (command.includes("commit-tree")) {
			const message = args[args.indexOf("-m") + 1] ?? "";
			const sha = `sha-${String(this.calls.length)}`;
			this.messages.set(sha, `${message}\n`);
			return `${sha}\n`;
		}

		if (command.startsWith("push ")) {
			if (this.transportDown) {
				throw new Error("fatal: unable to access 'https://github.com/x/y.git'");
			}

			const lease = args.find((arg) => arg.startsWith("--force-with-lease="));
			const expected = lease?.slice(`--force-with-lease=${leaseRef}:`.length) ?? "";
			if (expected !== this.remote) {
				throw new Error(
					"! [rejected] (stale info)\nerror: failed to push some refs to 'origin'",
				);
			}

			/*
			 * `push <lease> origin <sha>:<ref>` publishes; `push <lease> origin :<ref>` deletes. Both
			 * carry the expectation, which is what this fake enforces.
			 */
			const destination = args.at(-1) ?? "";
			this.remote = destination.startsWith(":") ? "" : (destination.split(":")[0] ?? "");

			return "";
		}

		throw new Error(`unexpected git call: ${command}`);
	};

	public hasOrigin = true;
	public readonly messages = new Map<string, string>();

	/** Publishes a lease onto the fake remote, as another machine would. */
	public publish(held: LeasePayload): void {
		const sha = `remote-${String(held.at)}`;
		this.messages.set(sha, JSON.stringify(held));
		this.remote = sha;
		this.local = sha;
	}
}

function payload(overrides: Partial<LeasePayload> = {}): LeasePayload {
	return { at: Date.now(), branch: "main", host: "other-machine", pid: 4321, ...overrides };
}

/** Collects console output (the lease warns and reports on stderr) while a callback runs. */
function capture<T>(run: () => T): { output: string; value: T } {
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

describe("dispatch lease", () => {
	test("off mode makes no git calls at all", () => {
		const git = new FakeGit();
		const { value } = capture(() => acquireDispatchLease({ mode: "off", run: git.run }));

		assert.equal(value.kind, "local");
		assert.equal(git.calls.length, 0);

		value.release();
		assert.equal(git.calls.length, 0);
	});

	test("a checkout without origin degrades to local locks and warns once", () => {
		const git = new FakeGit();
		git.hasOrigin = false;
		const { output, value } = capture(() => acquireDispatchLease({ run: git.run }));

		assert.equal(value.kind, "local");
		assert.match(output, /no `origin` remote/u);
	});

	test("strict mode refuses when the lease cannot be taken", () => {
		const git = new FakeGit();
		git.hasOrigin = false;

		assert.throws(
			() => acquireDispatchLease({ mode: "strict", run: git.run }),
			/queue\.lease is "strict"/u,
		);
	});

	test("a free ref is acquired, published, and deleted on release", () => {
		const git = new FakeGit();
		const { value } = capture(() => acquireDispatchLease({ run: git.run }));

		assert.equal(value.kind, "lease");
		assert.notEqual(git.remote, "", "the lease must be published before dispatching");
		assert.equal(JSON.parse(git.messages.get(git.remote) ?? "{}").pid, process.pid);

		value.release();
		assert.equal(git.remote, "", "release must delete the remote ref");
		assert.equal(git.local, "");
	});

	test("every push bypasses hooks: a pre-push typecheck would stall a renewal", () => {
		const git = new FakeGit();
		const { value } = capture(() => acquireDispatchLease({ run: git.run }));
		value.release();

		/*
		 * A repository's `pre-push` hook runs for any ref, including this one, even though the lease
		 * carries an empty tree that no CI builds. Without `--no-verify` every acquire, renewal, and
		 * release pays for a full verification pass — and a hook that rewrites files would race the
		 * agent working in the same tree.
		 */
		const pushes = git.calls.filter((call) => call.args[0] === "push");
		assert.ok(pushes.length >= 2, "expected an acquiring push and a deleting push");
		for (const push of pushes) {
			assert.ok(
				push.args.includes("--no-verify"),
				`push without --no-verify: ${push.args.join(" ")}`,
			);
		}
	});

	test("release is idempotent", () => {
		const git = new FakeGit();
		const { value } = capture(() => acquireDispatchLease({ run: git.run }));

		value.release();
		const afterFirst = git.calls.length;
		value.release();
		assert.equal(git.calls.length, afterFirst, "a second release must not touch git again");
	});

	test("a fresh lease held by another machine is refused, naming it", () => {
		const git = new FakeGit();
		git.publish(payload({ at: Date.now() - 60_000, host: "laptop", pid: 99 }));

		assert.throws(
			() => acquireDispatchLease({ run: git.run }),
			(err: unknown) =>
				err instanceof Error &&
				/Another checkout is dispatching this queue/u.test(err.message) &&
				/laptop/u.test(err.message) &&
				/pid 99/u.test(err.message),
		);
	});

	test("an expired lease is taken over instead of deadlocking the queue", () => {
		const git = new FakeGit();
		git.publish(payload({ at: Date.now() - leaseTtlMs - 60_000 }));

		const { output, value } = capture(() => acquireDispatchLease({ run: git.run }));

		assert.equal(value.kind, "lease");
		assert.match(output, /Taking over an expired dispatch lease/u);
	});

	test("losing the acquisition race is a refusal, not a silent local run", () => {
		const git = new FakeGit();
		/* Another machine publishes between this checkout's read and its push. */
		const original = git.run;
		const sneaky = (args: ReadonlyArray<string>): string => {
			if (args.join(" ").startsWith("push ")) {
				git.remote = "someone-else";
			}

			return original(args);
		};

		assert.throws(
			() => acquireDispatchLease({ run: sneaky }),
			/Another checkout took the dispatch lease while this one was acquiring it/u,
		);
	});

	test("an unreachable remote degrades in auto mode rather than blaming a race", () => {
		const git = new FakeGit();
		git.transportDown = true;
		const { output, value } = capture(() => acquireDispatchLease({ run: git.run }));

		assert.equal(value.kind, "local");
		assert.match(output, /lease unavailable.*git push origin.*failed/u);
		assert.doesNotMatch(output, /Another checkout took/u);
	});

	test("a lost renewal marks the handle lost and stops renewing", async () => {
		const git = new FakeGit();
		const { value } = capture(() =>
			acquireDispatchLease({ renewMs: 5, run: git.run, ttlMs: 10_000 }),
		);

		assert.equal(value.kind, "lease");
		assert.equal(value.lost(), false);

		/*
		 * Another machine force-pushes the ref. The next renewal's CAS then fails, which is the one
		 * signal that this dispatcher no longer owns the queue.
		 */
		git.remote = "stolen";
		await new Promise((resolve) => setTimeout(resolve, 40));

		assert.equal(value.lost(), true);
		value.release();
	});
});
